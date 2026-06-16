import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';

const CompanySettings: React.FC = () => {
  const [companyName, setCompanyName] = useState('RJD PISOWIFI');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const settings = await apiClient.getCompanySettings();
      if (settings.companyName) setCompanyName(settings.companyName);
      if (settings.companyLogo) setLogoPreview(settings.companyLogo);
    } catch (error) {
      console.error('Failed to fetch company settings:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('companyName', companyName);
      if (selectedFile) {
        formData.append('logo', selectedFile);
      }

      const updatedSettings = await apiClient.updateCompanySettings(formData);
      
      setCompanyName(updatedSettings.companyName);
      if (updatedSettings.companyLogo) setLogoPreview(updatedSettings.companyLogo);
      
      setMessage({ type: 'success', text: 'Settings saved successfully! Reloading page to apply changes...' });
      
      // Reload after a short delay to reflect changes in the layout
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save settings' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Company Settings</h2>
      
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {message && (
          <div className={`mb-4 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Company Name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="Enter your company name"
            />
            <p className="mt-1 text-xs text-gray-500">
              This name will be displayed in the admin dashboard header and portal.
            </p>
          </div>

          {/* Company Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Company Logo
            </label>
            
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Company Logo" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-400 text-xs">No Logo</span>
                  )}
                </div>
              </div>
              
              <div className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                  "
                />
                <p className="mt-2 text-xs text-gray-500">
                  Upload a PNG or JPG image. Recommended size: 100x100 pixels or similar aspect ratio.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 flex justify-end">
            <button
              type="submit"
              disabled={isLoading}
              className={`px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default CompanySettings;
