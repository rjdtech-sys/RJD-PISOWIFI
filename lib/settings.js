const db = require('./db');
const path = require('path');
const fs = require('fs');

// Get company settings
async function getCompanySettings() {
  try {
    const nameRow = await db.get("SELECT value FROM config WHERE key = ?", ['companyName']);
    const logoRow = await db.get("SELECT value FROM config WHERE key = ?", ['companyLogo']);

    return {
      companyName: nameRow ? nameRow.value : 'RJD PISOWIFI',
      companyLogo: logoRow ? logoRow.value : null
    };
  } catch (error) {
    console.error('Error getting company settings:', error);
    throw error;
  }
}

// Update company settings
async function updateCompanySettings(name, logoPath) {
  try {
    if (name) {
      await db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", ['companyName', name]);
      
      // Also update portal config title to match company name
      try {
        const portalConfigRow = await db.get("SELECT value FROM config WHERE key = ?", ['portal_config']);
        let portalConfig = portalConfigRow ? JSON.parse(portalConfigRow.value) : {};
        portalConfig.title = name;
        await db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", ['portal_config', JSON.stringify(portalConfig)]);
      } catch (e) {
        console.warn('Failed to sync portal title with company name:', e);
      }
    }
    
    if (logoPath) {
      await db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", ['companyLogo', logoPath]);
    }
    
    return await getCompanySettings();
  } catch (error) {
    console.error('Error updating company settings:', error);
    throw error;
  }
}

module.exports = {
  getCompanySettings,
  updateCompanySettings
};
