import React, { useState, useEffect } from 'react';
import { PortalConfig, fetchPortalConfig, savePortalConfigRemote, DEFAULT_PORTAL_CONFIG } from '../../lib/theme';

const PortalEditor: React.FC = () => {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchPortalConfig().then(setConfig);
  }, []);

  const [mode, setMode] = useState<'visual' | 'code'>('visual');

  const handleChange = (key: keyof PortalConfig, value: PortalConfig[keyof PortalConfig]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    await savePortalConfigRemote(config);
    setHasChanges(false);
    // Optional: Trigger a toast or notification
    alert('Portal configuration saved successfully!');
  };

  const handleReset = async () => {
    if (confirm('Reset portal configuration to defaults?')) {
      setConfig(DEFAULT_PORTAL_CONFIG);
      await savePortalConfigRemote(DEFAULT_PORTAL_CONFIG);
      setHasChanges(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: keyof PortalConfig) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('audio', file);

    const token = localStorage.getItem('ajc_admin_token');
    
    try {
      const res = await fetch('/api/admin/upload-audio', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      const data = await res.json();
      if (data.success) {
        handleChange(key, data.path);
      } else {
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Upload error');
    }
  };

  const insertCssTemplate = () => {
    const template = `/* Main Container */
.portal-container { }

/* Header */
.portal-header { }

/* Main Card */
.portal-card { }

/* Buttons */
.portal-btn { }

/* Rates */
.rates-grid { }
.rate-item { }
`;
    const newValue = config.customCss ? config.customCss + '\n\n' + template : template;
    handleChange('customCss', newValue);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto pb-20">
      
      {/* Editor Column */}
      <div className="xl:col-span-7 space-y-4">
        <section className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase tracking-widest flex items-center gap-2">
                <span className="p-1.5 bg-blue-600 rounded-lg text-white">🎨</span>
                Portal Designer
              </h2>
            </div>
            {hasChanges && (
              <span className="bg-amber-100 text-amber-700 text-[8px] font-black uppercase px-2 py-0.5 rounded-full tracking-widest animate-pulse border border-amber-200">
                Unsaved Changes
              </span>
            )}
          </div>

          {/* Mode Switcher */}
          <div className="flex p-1 bg-slate-100 rounded-lg mb-4">
            <button
              onClick={() => setMode('visual')}
              className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                mode === 'visual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Visual Editor
            </button>
            <button
              onClick={() => setMode('code')}
              className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                mode === 'code' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Code Editor
            </button>
          </div>

          {mode === 'visual' ? (
            <div className="space-y-4">
            {/* Text Content */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Portal Title</label>
                <input 
                  type="text" 
                  value={config.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>
              
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Subtitle / Slogan</label>
                <input 
                  type="text" 
                  value={config.subtitle}
                  onChange={(e) => handleChange('subtitle', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            <div className="h-px bg-slate-100"></div>

            {/* Colors */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Primary</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={config.primaryColor}
                    onChange={(e) => handleChange('primaryColor', e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-[9px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">{config.primaryColor}</span>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Secondary</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={config.secondaryColor}
                    onChange={(e) => handleChange('secondaryColor', e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-[9px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">{config.secondaryColor}</span>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Background</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={config.backgroundColor}
                    onChange={(e) => handleChange('backgroundColor', e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-[9px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">{config.backgroundColor}</span>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Text</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={config.textColor}
                    onChange={(e) => handleChange('textColor', e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-[9px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">{config.textColor}</span>
                </div>
              </div>
            </div>

            <div className="h-px bg-slate-100"></div>

            {/* Audio Settings */}
            <div>
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>🔊</span> Audio Assets
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { key: 'insertCoinAudio', label: 'Insert Coin', color: 'blue' },
                  { key: 'coinDropAudio', label: 'Coin Pulse', color: 'purple' },
                  { key: 'connectedAudio', label: 'Success', color: 'green' }
                ].map((audio) => (
                  <div key={audio.key} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5">{audio.label}</label>
                    
                    {config[audio.key as keyof PortalConfig] && (
                      <div className="mb-2">
                        <audio src={config[audio.key as keyof PortalConfig] as string} className="w-full h-6" />
                        <button 
                          onClick={() => handleChange(audio.key as keyof PortalConfig, '')}
                          className="text-[7px] text-red-500 font-bold uppercase mt-1 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    
                    <label className={`block w-full text-center py-1.5 rounded bg-${audio.color}-50 text-${audio.color}-700 text-[8px] font-black uppercase tracking-widest hover:bg-${audio.color}-100 transition-all cursor-pointer border border-${audio.color}-100`}>
                      Upload
                      <input 
                        type="file" 
                        accept="audio/*"
                        onChange={(e) => handleFileUpload(e, audio.key as keyof PortalConfig)}
                        className="hidden"
                      />
                    </label>
                  </div>
                ))}
            </div>

            <div className="h-px bg-slate-100"></div>

            <div>
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>🛰️</span> MAC Synchronizer
              </h4>

              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[10px] font-black text-slate-700 uppercase tracking-widest">
                    Status: {config.macSyncEnabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                    Controls how the portal links browser identity with device MAC.
                  </p>
                </div>
                <button
                  onClick={() => handleChange('macSyncEnabled', !config.macSyncEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    config.macSyncEnabled ? 'bg-blue-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.macSyncEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${config.macSyncEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                <button
                  onClick={() => handleChange('macSyncMode', 'fingerprint_mac')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    config.macSyncMode === 'fingerprint_mac'
                      ? 'border-blue-600 bg-blue-50 shadow-md shadow-blue-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-700 mb-1">
                    Fingerprint + MAC
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold leading-snug">
                    Uses browser fingerprint together with device MAC for tighter binding.
                  </p>
                </button>

                <button
                  onClick={() => handleChange('macSyncMode', 'session_token_mac')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    config.macSyncMode === 'session_token_mac'
                      ? 'border-emerald-600 bg-emerald-50 shadow-md shadow-emerald-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-700 mb-1">
                    Session ID + MAC
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold leading-snug">
                    Uses session token together with device MAC for session synchronization.
                  </p>
                </button>
              </div>
            </div>
          </div>
          ) : (
             <div className="space-y-4">
               <div>
                 <div className="flex justify-between items-center mb-1.5">
                   <label className="block text-[9px] font-black text-purple-600 uppercase tracking-widest">Custom CSS</label>
                   <button onClick={insertCssTemplate} className="text-[8px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-black hover:bg-purple-200 transition-colors uppercase">
                     Template
                   </button>
                 </div>
                 <textarea 
                   value={config.customCss || ''}
                  onChange={(e) => handleChange('customCss', e.target.value)}
                  placeholder=".portal-header { background: red !important; }"
                  className="w-full h-24 bg-slate-900 text-green-400 font-mono text-[10px] p-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-1.5">Header Injection</label>
                  <textarea 
                    value={config.customHtmlTop || ''}
                    onChange={(e) => handleChange('customHtmlTop', e.target.value)}
                    placeholder="HTML below header..."
                    className="w-full h-20 bg-slate-900 text-blue-400 font-mono text-[10px] p-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-1.5">Footer Injection</label>
                  <textarea 
                    value={config.customHtmlBottom || ''}
                    onChange={(e) => handleChange('customHtmlBottom', e.target.value)}
                    placeholder="HTML above footer..."
                    className="w-full h-20 bg-slate-900 text-blue-400 font-mono text-[10px] p-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button 
              onClick={handleSave}
              className="admin-btn-primary flex-1 py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 disabled:opacity-50"
            >
              Apply Design
            </button>
            <button 
              onClick={handleReset}
              className="px-4 py-3 rounded-lg font-black text-[10px] uppercase tracking-widest border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-500 transition-all"
            >
              Reset
            </button>
          </div>
        </section>
      </div>

      {/* Live Preview Column */}
      <div className="xl:col-span-5 space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Live Mobile View</h3>
          <span className="text-[8px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">Viewport: 320x640</span>
        </div>

        <div className="mx-auto w-[280px] h-[560px] border-[8px] border-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden bg-white relative">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-24 bg-slate-900 rounded-b-xl z-50"></div>
          
          {/* Preview Content */}
          <div 
            className="h-full w-full overflow-y-auto flex flex-col"
            style={{ backgroundColor: config.backgroundColor, color: config.textColor }}
          >
            {/* Header */}
            <div 
              className="pt-10 pb-12 px-4 text-center rounded-b-[20px] shadow-lg relative"
              style={{ background: `linear-gradient(135deg, ${config.primaryColor} 0%, ${config.secondaryColor} 100%)`, color: '#fff' }}
            >
              <h1 className="text-lg font-black tracking-tight mb-1 uppercase leading-tight">{config.title}</h1>
              <p className="text-[8px] font-bold opacity-80 uppercase tracking-widest">{config.subtitle}</p>
            </div>

            {/* Card */}
            <div className="flex-1 px-3 -mt-6 relative z-10">
              <div 
                className="bg-white/90 backdrop-blur-sm p-4 rounded-[20px] shadow-xl border border-white/20 text-center"
                style={{ color: '#0f172a' }}
              >
                <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: config.primaryColor }}>Connected Session</p>
                <h2 className="text-3xl font-black mb-3 tracking-tighter">00:00:00</h2>
                
                <div className="flex justify-center gap-2 mb-4">
                   <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                   <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">System Ready</span>
                </div>

                <div className="space-y-2">
                  <button 
                    className="w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest text-white shadow-md"
                    style={{ background: `linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)` }}
                  >
                    Pause Time
                  </button>
                  <button className="w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest bg-slate-100 text-slate-500">
                    Insert Coin
                  </button>
                </div>
              </div>

              {/* Rates Preview */}
              <div className="mt-4 grid grid-cols-2 gap-2 pb-6">
                {[1, 5].map((amt) => (
                   <div key={amt} className="bg-white p-2 rounded-xl text-center shadow-sm border border-slate-100">
                      <span className="block text-sm font-black text-slate-900">₱{amt}</span>
                      <span className="block text-[7px] font-black uppercase tracking-widest" style={{ color: config.primaryColor }}>
                        {amt === 1 ? '10 Mins' : '1 Hour'}
                      </span>
                   </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortalEditor;
