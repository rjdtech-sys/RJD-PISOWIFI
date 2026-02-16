import React, { useState, useEffect } from 'react';
import {
  THEMES,
  ThemeId,
  CustomThemeId,
  StoredCustomTheme,
  CustomThemeValues,
  getStoredAdminTheme,
  setAdminTheme,
  getCustomThemes,
  saveCustomThemes
} from '../../lib/theme';

interface ThemeEditorState {
  id: CustomThemeId;
  name: string;
  primary: string;
  primaryDark: string;
  bg: string;
  bgCard: string;
  textMain: string;
  textMuted: string;
  border: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarBg: string;
  sidebarBg: string;
}

const defaultEditorState: ThemeEditorState = {
  id: `custom-${Date.now()}`,
  name: 'Custom Theme',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  bg: '#f8fafc',
  bgCard: '#ffffff',
  textMain: '#0f172a',
  textMuted: '#64748b',
  border: '#e2e8f0',
  sidebarBg: '#0f172a',
  sidebarText: '#ffffff'
};

const ThemeSettings: React.FC = () => {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('default');
  const [customThemes, setCustomThemesState] = useState<StoredCustomTheme[]>([]);
  const [editor, setEditor] = useState<ThemeEditorState | null>(null);

  useEffect(() => {
    setCurrentTheme(getStoredAdminTheme());
    setCustomThemesState(getCustomThemes());
  }, []);

  const setCustomThemes = (themes: StoredCustomTheme[]) => {
    setCustomThemesState(themes);
    saveCustomThemes(themes);
  };

  const handleThemeChange = (id: ThemeId) => {
    setCurrentTheme(id);
    setAdminTheme(id);
  };

  const startNewCustomTheme = () => {
    const freshState: ThemeEditorState = {
      ...defaultEditorState,
      id: `custom-${Date.now()}`
    };
    setEditor(freshState);
  };

  const startEditCustomTheme = (theme: StoredCustomTheme) => {
    const values = theme.values;
    setEditor({
      id: theme.id,
      name: theme.name,
      primary: values.primary,
      primaryDark: values.primaryDark,
      bg: values.bg,
      bgCard: values.bgCard,
      textMain: values.textMain,
      textMuted: values.textMuted,
      border: values.border,
      sidebarBg: values.sidebarBg || '#0f172a',
      sidebarText: values.sidebarText || '#ffffff'
    });
  };

  const updateEditorField = (field: keyof ThemeEditorState, value: string) => {
    setEditor(prev => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSaveCustomTheme = () => {
    if (!editor) return;
    const values: CustomThemeValues = {
      primary: editor.primary,
      primaryDark: editor.primaryDark,
      bg: editor.bg,
      bgCard: editor.bgCard,
      textMain: editor.textMain,
      textMuted: editor.textMuted,
      border: editor.border,
      sidebarBg: editor.sidebarBg,
      sidebarText: editor.sidebarText
    };
    const payload: StoredCustomTheme = {
      id: editor.id,
      name: editor.name || 'Custom Theme',
      values
    };
    const existing = customThemes.findIndex(t => t.id === payload.id);
    if (existing >= 0) {
      const next = [...customThemes];
      next[existing] = payload;
      setCustomThemes(next);
    } else {
      setCustomThemes([...customThemes, payload]);
    }
    setCurrentTheme(payload.id);
    setAdminTheme(payload.id);
  };

  const handleDeleteCustomTheme = (id: CustomThemeId) => {
    const next = customThemes.filter(t => t.id !== id);
    setCustomThemes(next);
    if (currentTheme === id) {
      setCurrentTheme('default');
      setAdminTheme('default');
    }
    if (editor && editor.id === id) {
      setEditor(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <section className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <div className="mb-6">
          <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase tracking-widest flex items-center gap-2">
            <span className="p-1.5 bg-blue-600 rounded-lg text-white">🎨</span>
            Theme Engine
          </h2>
          <p className="text-slate-400 text-[9px] font-bold uppercase tracking-tighter mt-1">Select visual architecture for admin dashboard</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {THEMES.map((theme) => (
            <div 
              key={theme.id}
              onClick={() => handleThemeChange(theme.id)}
              className={`
                relative cursor-pointer overflow-hidden rounded-xl border transition-all duration-200 group
                ${currentTheme === theme.id 
                  ? 'border-blue-600 shadow-lg bg-blue-50/30' 
                  : 'border-slate-100 hover:border-slate-300 bg-white'}
              `}
            >
              <div className="p-3 h-full flex flex-col">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-[11px] font-black text-slate-900 uppercase">{theme.name}</h3>
                    <div className="flex items-center mt-1 space-x-1">
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                        theme.performanceScore === 100 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        PERF: {theme.performanceScore}%
                      </span>
                      {currentTheme === theme.id && (
                        <span className="text-[8px] font-black bg-blue-600 text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex -space-x-1.5">
                    {theme.previewColors.map((color, i) => (
                      <div 
                        key={i} 
                        className="w-5 h-5 rounded-full border border-white shadow-sm" 
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                
                <p className="text-[9px] text-slate-500 font-bold leading-tight mb-3 flex-grow uppercase tracking-tighter">
                  {theme.description}
                </p>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                   <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${currentTheme === theme.id ? 'bg-blue-500 animate-pulse' : 'bg-slate-200'}`}></div>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                        {currentTheme === theme.id ? 'Running' : 'Select'}
                      </span>
                   </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase tracking-widest flex items-center gap-2">
              <span className="p-1.5 bg-emerald-600 rounded-lg text-white">🧩</span>
              Custom Themes Editor
            </h2>
            <p className="text-slate-400 text-[9px] font-bold uppercase tracking-tighter mt-1">
              Gumawa at i-save ang sarili mong admin theme presets
            </p>
          </div>
          <button
            onClick={startNewCustomTheme}
            className="admin-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest"
          >
            <span>＋</span>
            New Theme
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            {customThemes.length === 0 && (
              <div className="border border-dashed border-slate-200 rounded-lg p-3 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                Walang custom theme. Pindutin ang New Theme para magsimula.
              </div>
            )}
            {customThemes.map(theme => (
              <div
                key={theme.id}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  currentTheme === theme.id ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => handleThemeChange(theme.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-1.5">
                    {[
                      theme.values.primary,
                      theme.values.bg,
                      theme.values.textMain
                    ].map((color, index) => (
                      <div
                        key={index}
                        className="w-5 h-5 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div>
                    <div className="text-[11px] font-black text-slate-900 uppercase">
                      {theme.name}
                    </div>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                      {currentTheme === theme.id ? 'Running' : 'Tap to apply'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      startEditCustomTheme(theme);
                    }}
                    className="px-2 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteCustomTheme(theme.id);
                    }}
                    className="px-2 py-1 rounded-md border border-red-100 text-[9px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50"
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-2">
            {editor && (
              <div className="border border-slate-200 rounded-lg p-4 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Theme name
                    </label>
                    <input
                      type="text"
                      value={editor.name}
                      onChange={e => updateEditorField('name', e.target.value)}
                      className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    />
                  </div>
                  <button
                    onClick={handleSaveCustomTheme}
                    className="px-4 py-2 rounded-md bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700"
                  >
                    Save Theme
                  </button>
                </div>

                <div
                  className="rounded-xl border border-slate-200 p-4 mb-2"
                  style={{ backgroundColor: editor.bg, color: editor.textMain }}
                >
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-70">
                    Preview
                  </div>
                  <div className="mt-2 mb-4 text-xs font-semibold">
                    {editor.name || 'Custom Theme'}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      className="rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                      style={{ backgroundColor: editor.sidebarBg, color: editor.sidebarText }}
                    >
                      Sidebar
                    </div>
                    <div
                      className="rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                      style={{ backgroundColor: editor.bgCard, color: editor.textMain }}
                    >
                      Card
                    </div>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                      style={{ backgroundColor: editor.primary, color: editor.bgCard }}
                    >
                      Primary Button
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { key: 'primary', label: 'Primary' },
                    { key: 'primaryDark', label: 'Primary Dark' },
                    { key: 'bg', label: 'Background' },
                    { key: 'bgCard', label: 'Card' },
                    { key: 'textMain', label: 'Text Main' },
                    { key: 'textMuted', label: 'Text Muted' },
                    { key: 'border', label: 'Border' },
                    { key: 'sidebarBg', label: 'Sidebar' },
                    { key: 'sidebarText', label: 'Sidebar Text' }
                  ].map(field => (
                    <label
                      key={field.key}
                      className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500"
                    >
                      <span className="w-24">{field.label}</span>
                      <input
                        type="color"
                        value={editor[field.key as keyof ThemeEditorState] as string}
                        onChange={e => updateEditorField(field.key as keyof ThemeEditorState, e.target.value)}
                        className="w-9 h-9 rounded-md border border-slate-200"
                      />
                      <input
                        type="text"
                        value={editor[field.key as keyof ThemeEditorState] as string}
                        onChange={e => updateEditorField(field.key as keyof ThemeEditorState, e.target.value)}
                        className="flex-1 text-[10px] px-2 py-1 rounded-md border border-slate-200 font-mono uppercase"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="bg-blue-900/5 rounded-xl p-3 border border-blue-100 flex items-start gap-3">
        <div className="text-lg">⚡</div>
        <div>
          <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-tight">Optimization Advisory</h4>
          <p className="text-[9px] text-blue-800/70 font-bold uppercase tracking-tighter leading-normal">
            Terminal theme reduces load by 40% on low-spec hardware (Pi Zero/Orange Pi One).
            Midnight theme is optimized for OLED displays.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ThemeSettings;
