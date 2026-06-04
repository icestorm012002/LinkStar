import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'yellow' | 'light' | 'dark';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

export interface Project {
  id: string;
  path: string;
  name: string;
  conversations: string[]; // conversation IDs
}

export interface DocumentEntry {
  id: string;
  filename: string;
  content: string;
}

export interface ActiveDocument {
  title: string;
  content: string;
  language?: string;
}

interface AppState {
  theme: Theme;
  setTheme: (theme: Theme) => void;

  projects: Project[];
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;

  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;

  addMessage: (conversationId: string, message: Message) => void;
  upsertMessage: (conversationId: string, message: Message) => void;

  activeTab: 'overview' | 'review';
  setActiveTab: (tab: 'overview' | 'review') => void;

  documents: DocumentEntry[];
  setDocuments: (docs: DocumentEntry[]) => void;
  
  activeDocument: ActiveDocument | null;
  setActiveDocument: (doc: ActiveDocument | null) => void;

  addProject: (name: string, path: string) => void;
  deleteProject: (id: string) => void;

  apiProvider: string;
  model: string;
  baseUrl: string;
  setApiModel: (provider: string, model: string, baseUrl?: string) => void;

  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  setConnectionState: (state: 'disconnected' | 'connecting' | 'connected' | 'error') => void;

  // Global full-screen module switching
  activeModule: 'chat' | 'media';
  setActiveModule: (module: 'chat' | 'media') => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'yellow',
      setTheme: (theme) => set({ theme }),

      projects: [
        { id: 'proj-1', name: 'Agent Cloud OS Architecture', path: '/e/Unreal/A1workhouse', conversations: ['conv-1'] }
      ],
      activeProjectId: 'proj-1',
      setActiveProject: (id) => set((state) => {
        const proj = state.projects.find(p => p.id === id);
        if (proj && !/^[A-Za-z]:[\\\/]/.test(proj.path) && !/^\//.test(proj.path)) {
          alert(`The path "${proj.path}" for project "${proj.name}" is invalid (must be an absolute path). Please delete this project and recreate it.`);
        }
        return { activeProjectId: id };
      }),

      conversations: {
        'conv-1': {
          id: 'conv-1',
          title: 'Iteration 5 实施计划',
          messages: [
            { id: 'm1', role: 'assistant', content: '我们将在 implementation_plan.md 中完整规划接下来的核心升级...' }
          ]
        }
      },
      activeConversationId: 'conv-1',
      setActiveConversation: (id) => set({ activeConversationId: id }),

      addMessage: (conversationId, message) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return {};
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              messages: [...conv.messages, message]
            }
          }
        };
      }),

      upsertMessage: (conversationId, message) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return {};

        const exists = conv.messages.some((m) => m.id === message.id);
        const newMessages = exists
          ? conv.messages.map((m) => (m.id === message.id ? message : m))
          : [...conv.messages, message];

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              messages: newMessages
            }
          }
        };
      }),

  activeTab: 'overview',
  setActiveTab: (tab) => set({ activeTab: tab }),

  documents: [
    { id: 'doc-1', filename: 'Implementation Plan', content: '# Plan\nThis is a mock plan.' },
    { id: 'doc-2', filename: 'Walkthrough', content: '# Walkthrough\nThis is a mock walkthrough.' },
  ],
  setDocuments: (docs) => set({ documents: docs }),
  
  activeDocument: null,
  setActiveDocument: (doc) => set({ activeDocument: doc }),

  addProject: (name, path) => set((state) => {
    // Validate absolute path
    if (!/^[A-Za-z]:[\\\/]/.test(path) && !/^\//.test(path)) {
      alert(`Invalid path: ${path}\nPlease provide a valid absolute path (e.g. E:\\my-project or /users/my-project)`);
      return state;
    }
    const id = `proj-${Date.now()}`;
    const newProject = {
      id,
      name,
      path,
      conversations: []
    };
    return {
      projects: [...state.projects, newProject],
      activeProjectId: id
    };
  }),

  deleteProject: (id) => set((state) => {
    const newProjects = state.projects.filter(p => p.id !== id);
    return {
      projects: newProjects,
      activeProjectId: state.activeProjectId === id 
        ? (newProjects.length > 0 ? newProjects[0].id : null) 
        : state.activeProjectId
    };
  }),

  apiProvider: localStorage.getItem('linkstar_api_provider') || 'anthropic',
  model: localStorage.getItem('linkstar_model') || 'claude-sonnet-4-20250514',
  baseUrl: localStorage.getItem('linkstar_base_url') || 'https://api.anthropic.com',
  setApiModel: (provider, model, baseUrl = '') => {
    localStorage.setItem('linkstar_api_provider', provider);
    localStorage.setItem('linkstar_model', model);
    localStorage.setItem('linkstar_base_url', baseUrl);
    set({ apiProvider: provider, model, baseUrl });
  },

  connectionState: 'disconnected',
  setConnectionState: (state) => set({ connectionState: state }),

  activeModule: 'chat',
  setActiveModule: (module) => set({ activeModule: module })
    }),
    {
      name: 'linkstar-app-storage',
    }
  )
);
