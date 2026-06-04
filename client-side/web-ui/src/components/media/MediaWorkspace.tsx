import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import './MediaWorkspace.css';

// ─── Types from Go Schema ───
interface UIParameter {
  id: string;
  label: string;
  type: 'text' | 'slider' | 'dropdown' | 'toggle' | 'number';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  multiline?: boolean;
  placeholder?: string;
}

interface EngineSchema {
  id: string;
  name: string;
  desc: string;
  parameters: UIParameter[];
}

// Category key mapping: sidebar label -> schema key
const MEDIA_CATEGORIES = [
  { key: 'image', label: 'Prompts', icon: 'auto_awesome' },
  { key: 'video', label: 'Video',   icon: 'movie' },
  { key: 'audio', label: 'Sound',   icon: 'mic' },
] as const;
type MediaCategory = typeof MEDIA_CATEGORIES[number]['key'];

export function MediaWorkspace() {
  const [schema, setSchema] = useState<Record<string, EngineSchema[]>>({});
  const [mediaType, setMediaType] = useState<MediaCategory>('image');
  const [engineId, setEngineId] = useState<string>('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [outputDir] = useState('E:/Unreal/A1workhouse/media_output');
  const [toast, setToast] = useState('');
  
  const setActiveModule = useAppStore(state => state.setActiveModule);

  // Helper: select first engine of a given category and init its form
  const selectFirstEngine = (data: Record<string, EngineSchema[]>, category: MediaCategory) => {
    const engines = data[category];
    if (engines && engines.length > 0) {
      const first = engines[0];
      setEngineId(first.id);
      const init: Record<string, any> = {};
      first.parameters.forEach((p: UIParameter) => { init[p.id] = p.default; });
      setFormData(init);
    }
  };

  useEffect(() => {
    fetch('/api/media/schema')
      .then(res => res.json())
      .then(data => {
        if (data) {
          setSchema(data);
          selectFirstEngine(data, 'image');
        }
      })
      .catch(err => console.error('Failed to load schema:', err));
  }, []);

  const switchMediaType = (cat: MediaCategory) => {
    setMediaType(cat);
    selectFirstEngine(schema, cat);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const currentEngines = schema[mediaType] || [];
  const activeEngine = currentEngines.find(e => e.id === engineId) || currentEngines[0];

  const setParam = (id: string, v: any) => setFormData(prev => ({ ...prev, [id]: v }));

  const handleGenerate = () => {
    if (!activeEngine) return;
    const flags = Object.entries(formData).map(([k, v]) => `--${k} "${v}"`).join(' ');
    const cmd = `media-cli ${mediaType} ${activeEngine.id} ${flags} --output "${outputDir}"`;
    console.log('[MediaWorkspace] Execute:', cmd);
    showToast(`Started ${mediaType} generation...`);
  };

  // Extract prompt param and other controls
  const promptParam = activeEngine?.parameters.find(p => p.type === 'text' && p.multiline);
  const controlParams = activeEngine?.parameters.filter(p => !(p.type === 'text' && p.multiline)) || [];

  // Gallery placeholder icon by media type
  const galleryIcon = mediaType === 'video' ? 'videocam' : mediaType === 'audio' ? 'music_note' : 'image';
  const galleryLabel = mediaType === 'video' ? 'Video Preview' : mediaType === 'audio' ? 'Audio Preview' : 'Gallery View';
  const generateLabel = mediaType === 'video' ? 'Generate Video' : mediaType === 'audio' ? 'Generate Audio' : 'Generate Art';
  const generateIcon = mediaType === 'video' ? 'movie_creation' : mediaType === 'audio' ? 'graphic_eq' : 'magic_button';

  return (
    <div className="bg-background text-on-surface h-full w-full overflow-hidden flex flex-col font-body-md dark">
      {/* TopNavBar */}
      <header className="bg-surface-container/50 backdrop-blur-xl border-b border-white/5 flex justify-between items-center w-full px-margin-desktop h-16 shrink-0 z-50">
        <div className="flex items-center gap-md">
          <span className="font-headline-lg text-headline-lg font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent tracking-tight">Ethereal Forge</span>
        </div>
        
        <nav className="hidden md:flex gap-lg items-center h-full">
          <button className="bg-transparent border-none text-primary font-bold border-b-2 border-primary pb-1 flex items-center h-full pt-1 hover:text-primary transition-colors duration-200">Workbench</button>
          <button className="bg-transparent border-none text-on-surface-variant font-medium flex items-center h-full hover:text-primary transition-colors duration-200">Assets</button>
          <button className="bg-transparent border-none text-on-surface-variant font-medium flex items-center gap-xs h-full hover:text-primary transition-colors duration-200">
            <span className="material-symbols-outlined text-[20px]">history</span> History
          </button>
          <button className="bg-transparent border-none text-on-surface-variant font-medium flex items-center gap-xs h-full hover:text-primary transition-colors duration-200">
            <span className="material-symbols-outlined text-[20px]">layers</span> Layers
          </button>
          <button onClick={() => setActiveModule('chat')} className="bg-transparent border-none text-on-surface-variant font-medium flex items-center h-full hover:text-primary transition-colors duration-200">
            Exit Studio
          </button>
        </nav>
        
        <div className="flex items-center gap-md">
          <select 
            className="font-label-mono text-label-mono text-on-surface-variant bg-surface-container-lowest border border-outline-variant px-md py-sm rounded focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
            value={engineId}
            onChange={(e) => {
               setEngineId(e.target.value);
               const newEngine = currentEngines.find(eng => eng.id === e.target.value);
               if (newEngine) {
                 const init: Record<string, any> = {};
                 newEngine.parameters.forEach(p => { init[p.id] = p.default; });
                 setFormData(init);
               }
            }}
          >
            {currentEngines.map(eng => (
              <option key={eng.id} value={eng.id}>{eng.name}</option>
            ))}
          </select>
          
          <button onClick={handleGenerate} className="border-none font-label-mono text-label-mono bg-gradient-to-r from-primary-container to-primary text-on-primary-container px-md py-sm rounded hover:scale-95 transition-transform">
            Generate
          </button>
          
          <div className="flex gap-sm text-on-surface-variant ml-sm">
            <button className="bg-transparent border-none hover:text-primary transition-colors"><span className="material-symbols-outlined">settings</span></button>
            <button className="bg-transparent border-none hover:text-primary transition-colors"><span className="material-symbols-outlined">notifications</span></button>
          </div>
          <div className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant overflow-hidden ml-sm shrink-0">
             <div className="w-full h-full flex items-center justify-center bg-primary text-on-primary-container font-bold">U</div>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-surface-container-highest text-on-surface px-lg py-sm rounded-full shadow-lg z-50 border border-white/10 font-label-mono animate-fade-in-down">
          {toast}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* SideNavBar */}
        <aside className="bg-surface-container-lowest/30 backdrop-blur-md border-r border-white/5 h-full w-20 flex flex-col items-center py-6 gap-8 shrink-0 z-40 relative">
          <div className="flex flex-col items-center gap-xs cursor-pointer group">
            <div className="w-10 h-10 rounded-lg bg-surface-container-highest border border-white/10 flex items-center justify-center text-on-surface group-hover:border-secondary transition-colors">
              <span className="font-headline-lg text-[20px] leading-none">A</span>
            </div>
          </div>
          
          <nav className="flex flex-col gap-sm w-full px-sm flex-1">
            {MEDIA_CATEGORIES.map(cat => {
              const isActive = mediaType === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => switchMediaType(cat.key)}
                  className={`border-none w-full aspect-square flex flex-col items-center justify-center gap-xs rounded-lg transition-all duration-150 relative ${
                    isActive ? 'text-primary translate-x-1' : 'bg-transparent text-outline hover:bg-surface-container-high group'
                  }`}
                  style={isActive ? { backgroundColor: 'rgba(208, 188, 255, 0.1)' } : {}}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-[0_0_8px_rgba(208,188,255,0.6)]"></div>
                  )}
                  <span
                    className={`material-symbols-outlined text-[24px] ${isActive ? '' : 'group-hover:text-primary transition-colors'}`}
                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                  >{cat.icon}</span>
                  <span className={`font-label-mono text-[10px] uppercase ${isActive ? '' : 'opacity-70 group-hover:text-primary transition-colors'}`}>{cat.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Canvas */}
        <main className="flex-1 overflow-y-auto bg-background p-gutter md:p-lg flex flex-col gap-lg relative">
          
          {/* Output Gallery Area */}
          <div className="flex-1 glass-panel rounded-xl flex flex-col overflow-hidden">
            <div className="h-10 border-b border-white/5 flex items-center px-md gap-md bg-surface-container-low/50">
              <span className="font-label-mono text-label-mono text-on-surface-variant flex items-center gap-xs"><span className="material-symbols-outlined text-[16px]">view_carousel</span> {galleryLabel}</span>
              <div className="flex-1"></div>
              <button className="bg-transparent border-none text-outline hover:text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">zoom_in</span></button>
              <button className="bg-transparent border-none text-outline hover:text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">fit_screen</span></button>
            </div>
            <div className="flex-1 p-md grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-md overflow-y-auto">
              
              {/* Dummy Gallery Item */}
              <div className="aspect-square bg-surface-container-low rounded-lg border border-white/5 overflow-hidden relative group cursor-pointer ring-1 ring-primary glow-active">
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                   <span className="font-label-mono text-primary bg-primary-fixed/10 px-2 py-1 rounded">No preview yet</span>
                </div>
                <div className="w-full h-full flex items-center justify-center bg-surface-container-highest opacity-20">
                  <span className="material-symbols-outlined text-4xl text-outline">{galleryIcon}</span>
                </div>
              </div>
              
            </div>
          </div>
          
          {/* Prompt Editor */}
          {promptParam && (
          <div className="glass-panel rounded-xl flex flex-col shrink-0">
            <div className="h-10 border-b border-white/5 flex items-center px-md gap-md bg-surface-container-low/50">
              <span className="font-label-mono text-label-mono text-primary flex items-center gap-xs"><span className="material-symbols-outlined text-[16px]">edit_note</span> Master Prompt</span>
            </div>
            <div className="p-sm">
              <textarea 
                className="w-full bg-surface-container-lowest text-on-surface font-body-md p-md rounded-lg border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none h-32 focus:outline-none placeholder-outline/50" 
                placeholder={promptParam.placeholder || "Describe the scene..."}
                value={formData[promptParam.id] || ''}
                onChange={e => setParam(promptParam.id, e.target.value)}
              />
            </div>
          </div>
          )}
        </main>

        {/* Right Inspector Panel */}
        <aside className="w-80 bg-surface-container/30 border-l border-white/5 h-full overflow-y-auto shrink-0 flex flex-col relative z-40 backdrop-blur-xl">
          <div className="p-md border-b border-white/5 bg-surface-container-lowest/50 sticky top-0 z-10 backdrop-blur-md">
            <h2 className="font-headline-lg text-[18px] font-semibold text-on-surface">Generation Parameters</h2>
            {activeEngine && <p className="text-label-mono text-outline mt-1">{activeEngine.name}</p>}
          </div>
          
          <div className="p-md flex flex-col gap-lg">
            
            {controlParams.map(param => {
              if (param.type === 'slider') {
                return (
                  <div key={param.id} className="flex flex-col gap-xs">
                    <div className="flex justify-between items-center">
                      <label className="font-label-mono text-label-mono text-on-surface-variant uppercase">{param.label}</label>
                      <span className="font-label-mono text-[10px] text-on-surface bg-surface-container-high px-1 rounded">{formData[param.id] ?? param.default}</span>
                    </div>
                    <input 
                      className="w-full accent-primary h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer" 
                      type="range" 
                      min={param.min} 
                      max={param.max}
                      step={param.step}
                      value={formData[param.id] ?? param.default}
                      onChange={e => setParam(param.id, parseFloat(e.target.value))}
                    />
                  </div>
                );
              }
              
              if (param.type === 'dropdown') {
                return (
                  <div key={param.id} className="flex flex-col gap-xs">
                    <div className="flex justify-between items-center">
                      <label className="font-label-mono text-label-mono text-on-surface-variant uppercase">{param.label}</label>
                    </div>
                    <select
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded px-sm py-2 text-body-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                      value={formData[param.id] ?? param.default}
                      onChange={e => setParam(param.id, e.target.value)}
                    >
                      {param.options?.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              
              if (param.type === 'number') {
                return (
                  <div key={param.id} className="flex flex-col gap-xs">
                    <label className="font-label-mono text-label-mono text-on-surface-variant uppercase">{param.label}</label>
                    <div className="flex gap-sm">
                      <input 
                        className="flex-1 bg-surface-container-lowest border border-outline-variant rounded px-sm py-xs text-body-sm text-on-surface font-label-mono focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none" 
                        type="number" 
                        min={param.min}
                        max={param.max}
                        value={formData[param.id] ?? param.default}
                        onChange={e => setParam(param.id, parseInt(e.target.value) || param.default)}
                      />
                      {param.id === 'seed' && (
                        <button 
                          onClick={() => setParam(param.id, -1)}
                          className="bg-transparent border border-outline-variant rounded px-sm text-outline hover:text-primary hover:border-primary transition-colors flex items-center"
                          title="Set to random (-1)"
                        >
                          <span className="material-symbols-outlined text-[16px]">shuffle</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              if (param.type === 'toggle') {
                return (
                  <div key={param.id} className="flex justify-between items-center bg-surface-container-low p-2 rounded border border-white/5">
                    <label className="font-label-mono text-label-mono text-on-surface-variant uppercase">{param.label}</label>
                    <button 
                      onClick={() => setParam(param.id, !formData[param.id])}
                      className={`border-none outline-none w-8 h-4 rounded-full relative transition-colors ${formData[param.id] ? 'bg-primary' : 'bg-surface-container-highest'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${formData[param.id] ? 'left-4.5 translate-x-[14px]' : 'left-0.5 translate-x-0'}`}></div>
                    </button>
                  </div>
                );
              }
              
              // Fallback text input
              return (
                  <div key={param.id} className="flex flex-col gap-xs">
                    <label className="font-label-mono text-label-mono text-on-surface-variant uppercase">{param.label}</label>
                    <input 
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded px-sm py-xs text-body-sm text-on-surface focus:border-primary focus:outline-none" 
                      type="text" 
                      value={formData[param.id] || ''}
                      onChange={e => setParam(param.id, e.target.value)}
                    />
                  </div>
              );
            })}
            
          </div>
          
          {/* Action Area */}
          <div className="mt-auto p-md border-t border-white/5 bg-surface-container-lowest/50 backdrop-blur-md sticky bottom-0">
            <button 
              onClick={handleGenerate}
              className="border-none w-full py-md bg-gradient-to-r from-primary-container to-primary text-on-primary-container font-headline-lg text-[16px] font-bold rounded-lg hover:shadow-[0_0_20px_rgba(208,188,255,0.4)] transition-all flex items-center justify-center gap-sm active:scale-95"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{generateIcon}</span>
              {generateLabel}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
