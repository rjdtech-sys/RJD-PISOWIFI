package com.rjdpisowifi.phonerental.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.widget.ImageView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

/**
 * WallpaperManager - Handles downloading, caching, and displaying wallpapers
 * Supports both server-uploaded and locally-selected wallpapers
 */
class WallpaperManager(private val context: Context) {

    companion object {
        private const val TAG = "WallpaperManager"
        private const val WALLPAPER_DIR = "wallpapers"
        private const val WALLPAPER_FILE = "current_wallpaper.jpg"
    }

    private val wallpaperDir = File(context.filesDir, WALLPAPER_DIR)
    private val client = OkHttpClient()

    /**
     * Find the current wallpaper file (dynamic extension)
     */
    private fun getWallpaperFile(): File? {
        return wallpaperDir.listFiles()?.find { it.name.startsWith("wallpaper") && it.isFile }
    }

    /**
     * Download wallpaper from server
     * @param deviceId The device ID
     * @param serverUrl The server base URL
     * @return true if wallpaper was downloaded and saved
     */
    suspend fun downloadWallpaper(deviceId: String, serverUrl: String): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                // Ensure directory exists
                if (!wallpaperDir.exists()) {
                    wallpaperDir.mkdirs()
                }

                val wallpaperUrl = "$serverUrl/api/phone-rental/devices/$deviceId/wallpaper"
                Log.d(TAG, "Downloading wallpaper from: $wallpaperUrl")

                val request = Request.Builder()
                    .url(wallpaperUrl)
                    .build()

                val response = client.newCall(request).execute()
                
                if (!response.isSuccessful) {
                    Log.w(TAG, "Wallpaper download failed: ${response.code}")
                    return@withContext false
                }

                // Determine file extension from Content-Type header
                val contentType = response.header("Content-Type", "image/jpeg")
                val extension = when {
                    contentType?.contains("gif") == true -> ".gif"
                    contentType?.contains("png") == true -> ".png"
                    contentType?.contains("webp") == true -> ".webp"
                    contentType?.contains("bmp") == true -> ".bmp"
                    contentType?.contains("tiff") == true -> ".tiff"
                    else -> ".jpg"
                }
                Log.d(TAG, "Server content-type: $contentType, using extension: $extension")

                // Delete old wallpaper files to prevent stale data
                wallpaperDir.listFiles()?.forEach { file ->
                    if (file.name.startsWith("wallpaper")) {
                        file.delete()
                        Log.d(TAG, "Deleted old wallpaper: ${file.name}")
                    }
                }

                // Create new file with correct extension
                val newWallpaperFile = File(wallpaperDir, "wallpaper$extension")

                // Save to file
                val inputStream = response.body?.byteStream()
                if (inputStream != null) {
                    FileOutputStream(newWallpaperFile).use { output ->
                        inputStream.copyTo(output)
                    }
                    Log.d(TAG, "Wallpaper saved to: ${newWallpaperFile.absolutePath} (${newWallpaperFile.length()} bytes)")
                    return@withContext true
                }

                false
            } catch (e: Exception) {
                Log.e(TAG, "Error downloading wallpaper: ${e.message}", e)
                false
            }
        }
    }

    /**
     * Display wallpaper on ImageView (supports GIF animation)
     * @param imageView The ImageView to display the wallpaper on
     * @return true if wallpaper was loaded
     */
    fun displayWallpaper(imageView: ImageView): Boolean {
        return try {
            val wallpaperFile = getWallpaperFile()
            if (wallpaperFile == null || !wallpaperFile.exists()) {
                Log.d(TAG, "No wallpaper file found")
                imageView.visibility = android.view.View.GONE
                return false
            }

            // Check if it's a GIF
            val isGif = wallpaperFile.name.endsWith(".gif", ignoreCase = true)
            
            if (isGif) {
                Log.d(TAG, "Loading animated GIF wallpaper (cache disabled)")
                // Use Glide for GIF animation
                Glide.with(imageView.context)
                    .asGif()
                    .load(wallpaperFile)
                    .skipMemoryCache(true)
                    .diskCacheStrategy(DiskCacheStrategy.NONE)
                    .transition(DrawableTransitionOptions.withCrossFade())
                    .centerCrop()
                    .into(imageView)
            } else {
                Log.d(TAG, "Loading static image wallpaper (cache disabled)")
                // Use Glide for static images (more efficient than BitmapFactory)
                Glide.with(imageView.context)
                    .load(wallpaperFile)
                    .skipMemoryCache(true)
                    .diskCacheStrategy(DiskCacheStrategy.NONE)
                    .transition(DrawableTransitionOptions.withCrossFade())
                    .centerCrop()
                    .into(imageView)
            }
            
            imageView.visibility = android.view.View.VISIBLE
            Log.d(TAG, "Wallpaper displayed successfully")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error displaying wallpaper: ${e.message}", e)
            imageView.visibility = android.view.View.GONE
            false
        }
    }

    /**
     * Load bitmap efficiently with sampling to avoid OOM
     */
    private fun loadBitmapEfficiently(file: File): Bitmap? {
        return try {
            // First decode with inJustDecodeBounds=true to check dimensions
            val options = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(file.absolutePath, options)

            // Calculate inSampleSize
            options.inSampleSize = calculateInSampleSize(options)

            // Decode bitmap with inSampleSize set
            options.inJustDecodeBounds = false
            BitmapFactory.decodeFile(file.absolutePath, options)
        } catch (e: Exception) {
            Log.e(TAG, "Error loading bitmap: ${e.message}", e)
            null
        }
    }

    /**
     * Calculate sample size for efficient loading
     */
    private fun calculateInSampleSize(options: BitmapFactory.Options): Int {
        val (outHeight, outWidth) = options.outHeight to options.outWidth
        var inSampleSize = 1

        // Target max dimension (2K resolution should be enough for most devices)
        val maxDimension = 2048

        if (outHeight > maxDimension || outWidth > maxDimension) {
            val halfHeight = outHeight / 2
            val halfWidth = outWidth / 2

            while ((halfHeight / inSampleSize) >= maxDimension &&
                   (halfWidth / inSampleSize) >= maxDimension) {
                inSampleSize *= 2
            }
        }

        return inSampleSize
    }

    /**
     * Delete current wallpaper
     */
    fun deleteWallpaper(): Boolean {
        return try {
            val wallpaperFile = getWallpaperFile()
            if (wallpaperFile != null && wallpaperFile.exists()) {
                wallpaperFile.delete()
                Log.d(TAG, "Wallpaper deleted")
                true
            } else {
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error deleting wallpaper: ${e.message}", e)
            false
        }
    }

    /**
     * Check if wallpaper exists
     */
    fun hasWallpaper(): Boolean {
        return getWallpaperFile()?.exists() ?: false
    }

    /**
     * Clear cached wallpaper
     */
    fun clearCache(): Boolean {
        return try {
            if (wallpaperDir.exists()) {
                wallpaperDir.deleteRecursively()
                Log.d(TAG, "Wallpaper cache cleared")
                true
            } else {
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing cache: ${e.message}", e)
            false
        }
    }
}
