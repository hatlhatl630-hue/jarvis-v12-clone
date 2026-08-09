'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Bot, User, Copy, Check, Trash2, ChevronDown, Zap, RotateCcw, Globe, Wifi, WifiOff, ListTodo, X, ChevronRight, Clock } from 'lucide-react';
import { Toaster, toast } from 'sonner';

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  thinkingSteps?: ThinkingStep[];
  thinkingTime?: number;
  provider?: string;
}

interface ThinkingStep {
  label: string;
  detail: string;
  phase?: string;
  duration?: number;
}

interface TodoItem {
  id: string;
  text: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'completed';
  createdAt: number;
}

interface ProviderInfo {
  name: string;
  active: boolean;
  available: boolean;
}

// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════

const PHASE_COLORS: Record<string, string> = {
  deep_analysis: '#ffd60a',
  strategy: '#4d8dff',
  knowledge: '#ff6b2b',
  execution: '#00d4ff',
  verification: '#00ff88',
  action: '#ff44aa',
  result: '#00ff88',
  error: '#ff4444',
};

const PHASE_ORDER = ['deep_analysis', 'strategy', 'knowledge', 'execution', 'verification', 'action', 'result', 'error'];

function getPhaseColor(phase?: string): string {
  return PHASE_COLORS[phase || 'unknown'] || '#556677';
}

function formatElapsed(ms: number): string {
  if (ms < 100) return '<0.1s';
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m${sec}s`;
}

// ═══════════════════════════════════════════════
// MARKDOWN RENDERER (lightweight)
// ═══════════════════════════════════════════════

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const label = lang ? `<div style="font-size:10px;color:#6b7a99;padding:4px 12px;background:#080c16;border-bottom:1px solid #1a2440;border-radius:6px 6px 0 0">${lang}</div>` : '';
    return `${label}<pre style="background:#080c16;padding:12px;border-radius:${lang ? '0 0 6px 6px' : '6px'};overflow-x:auto;font-size:12px;font-family:monospace;line-height:1.6;margin:6px 0"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`(.*?)`/g, '<code style="background:#1a2235;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace;color:#00d4ff">$1</code>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br/>');

  return html;
}

// ═══════════════════════════════════════════════
// THINKING DISPLAY (GLM-5 Style)
// ═══════════════════════════════════════════════

function ThinkingDisplay({ steps, isLive, elapsed }: { steps: ThinkingStep[]; isLive: boolean; elapsed?: number }) {
  const [collapsed, setCollapsed] = useState(!isLive);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(!isLive);
  }, [isLive]);

  // Auto-scroll thinking steps
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps, isLive]);

  if (steps.length === 0) return null;

  const stepCount = steps.length;
  const displayElapsed = elapsed || 0;

  // Count phases for summary
  const phaseCounts: Record<string, number> = {};
  steps.forEach(s => { phaseCounts[s.phase || 'other'] = (phaseCounts[s.phase || 'other'] || 0) + 1; });
  const actionCount = phaseCounts['action'] || 0;
  const resultCount = phaseCounts['result'] || 0;
  const errorCount = phaseCounts['error'] || 0;

  return (
    <div
      className={isLive ? 'animate-glow' : ''}
      style={{
        background: 'linear-gradient(135deg, rgba(0,212,255,0.04), rgba(255,107,43,0.03))',
        border: '1px solid rgba(0,212,255,0.12)',
        borderRadius: '10px',
        marginBottom: '8px',
        fontSize: '11px',
        overflow: 'hidden',
      }}
    >
      {/* Header - always visible */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={13} style={{
            color: isLive ? '#00d4ff' : '#555',
            animation: isLive ? 'spin 1s linear infinite' : 'none',
          }} />
          {collapsed ? (
            <span style={{ color: '#8899b4', fontWeight: 600, fontSize: '11px' }}>
              JARVIS thought for {formatElapsed(displayElapsed)}
            </span>
          ) : (
            <span style={{ color: '#00d4ff', fontWeight: 600, fontSize: '11px', letterSpacing: '0.5px' }}>
              JARVIS v11 · {isLive ? 'THINKING' : 'THOUGHT'}
            </span>
          )}
          {isLive && (
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#00d4ff' }} className="animate-pulse-dot" />
          )}
          {/* Summary chips when collapsed */}
          {collapsed && (actionCount > 0 || errorCount > 0) && (
            <span style={{ color: '#3a4560', fontSize: '9px' }}>
              {actionCount > 0 && `${actionCount} actions`}{actionCount > 0 && errorCount > 0 && ' · '}{errorCount > 0 && `${errorCount} errors`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Timer */}
          {(isLive || displayElapsed > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#556677', fontSize: '10px' }}>
              <Clock size={9} />
              {formatElapsed(displayElapsed)}
            </div>
          )}
          {/* Step count when collapsed */}
          {collapsed && (
            <span style={{ color: '#3a4560', fontSize: '10px' }}>({stepCount} steps)</span>
          )}
          {/* Collapse toggle */}
          <ChevronRight size={12} style={{
            color: '#556677',
            transform: collapsed ? 'none' : 'rotate(90deg)',
            transition: 'transform 0.2s ease',
          }} />
        </div>
      </div>

      {/* Steps - shown when expanded */}
      {!collapsed && (
        <div
          ref={scrollRef}
          style={{
            padding: '0 14px 12px 14px',
            borderTop: '1px solid rgba(0,212,255,0.06)',
            maxHeight: isLive ? '280px' : '400px',
            overflowY: 'auto',
          }}
        >
          {/* Phase progress bar */}
          <div style={{
            display: 'flex',
            gap: '3px',
            padding: '8px 0',
            marginBottom: '6px',
          }}>
            {PHASE_ORDER.filter(p => steps.some(s => s.phase === p)).map(phase => (
              <div key={phase} style={{
                flex: 1,
                height: '2px',
                borderRadius: '1px',
                background: getPhaseColor(phase),
                opacity: 0.5,
              }} />
            ))}
          </div>

          {steps.map((step, i) => {
            const isAction = step.phase === 'action';
            const isError = step.phase === 'error';
            const isResult = step.phase === 'result';

            return (
              <div
                key={i}
                className="animate-step-reveal"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '5px 0',
                  ...(isAction ? { paddingLeft: '8px', borderLeft: '2px solid rgba(255,68,170,0.4)', marginLeft: '2px' } : {}),
                  ...(isError ? { paddingLeft: '8px', borderLeft: '2px solid rgba(255,68,68,0.4)', marginLeft: '2px' } : {}),
                  ...(isResult ? { paddingLeft: '8px', borderLeft: '2px solid rgba(0,255,136,0.3)', marginLeft: '2px' } : {}),
                }}
              >
                {/* Phase dot */}
                {!isAction && !isError && !isResult && (
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: getPhaseColor(step.phase),
                    marginTop: '5px',
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${getPhaseColor(step.phase)}40`,
                  }} />
                )}

                {/* Step content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      color: isAction ? '#ff44aa' : isError ? '#ff4444' : isResult ? '#00ff88' : getPhaseColor(step.phase),
                      fontWeight: 600,
                      fontSize: isAction || isError || isResult ? '11px' : '11px',
                    }}>
                      {isAction ? '⚡ ' : isError ? '✗ ' : isResult ? '✓ ' : ''}{step.label}
                    </span>
                    {step.duration && step.duration > 0 && (
                      <span style={{ color: '#3a4560', fontSize: '9px', flexShrink: 0 }}>
                        {formatElapsed(step.duration)}
                      </span>
                    )}
                  </div>
                  {step.detail && (
                    <div style={{
                      color: isError ? '#ff6b6b' : isResult ? '#7adbaa' : '#556677',
                      fontSize: '10px',
                      marginTop: '2px',
                      wordBreak: 'break-word',
                      lineHeight: 1.5,
                      fontFamily: isAction || isError || isResult ? 'monospace' : 'inherit',
                    }}>
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Live indicator at bottom */}
          {isLive && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              paddingTop: '8px', marginTop: '4px',
              borderTop: '1px solid rgba(0,212,255,0.06)',
              color: '#3a4560', fontSize: '10px',
            }}>
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="animate-pulse-dot"
                  style={{
                    display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                    background: '#00d4ff', animationDelay: `${i * 0.3}s`,
                  }}
                />
              ))}
              <span>Still thinking...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TODO PANEL
// ═══════════════════════════════════════════════

function TodoPanel({ todos, onClose, onToggle, onRemove, onAdd }: {
  todos: TodoItem[];
  onClose: () => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (text: string, priority: 'high' | 'medium' | 'low') => void;
}) {
  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    onAdd(text, newPriority);
    setNewText('');
  };

  const pendingCount = todos.filter(t => t.status === 'pending').length;

  const priorityColors: Record<string, string> = { high: '#ff4444', medium: '#ff6b2b', low: '#00ff88' };
  const priorityBg: Record<string, string> = {
    high: 'rgba(255,68,68,0.08)',
    medium: 'rgba(255,107,43,0.08)',
    low: 'rgba(0,255,136,0.08)',
  };
  const priorityBorder: Record<string, string> = {
    high: 'rgba(255,68,68,0.2)',
    medium: 'rgba(255,107,43,0.2)',
    low: 'rgba(0,255,136,0.2)',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      {/* Backdrop */}
      <div
        className="animate-backdrop-in"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
      />

      {/* Panel */}
      <div
        className="animate-slide-right"
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 'min(340px, 100vw)',
          background: 'rgba(10,14,26,0.98)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ListTodo size={16} color="#00d4ff" />
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#e8edf5' }}>Tasks</span>
            {pendingCount > 0 && (
              <span style={{
                background: 'rgba(0,212,255,0.15)',
                color: '#00d4ff',
                fontSize: '10px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: '10px',
              }}>
                {pendingCount}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#556677', cursor: 'pointer', padding: '4px',
            display: 'flex', alignItems: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Todo list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {todos.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 16px',
              color: '#3a4560', fontSize: '12px',
            }}>
              <ListTodo size={24} style={{ margin: '0 auto 8px', opacity: 0.4, display: 'block' }} />
              No tasks yet. JARVIS can create tasks or add them manually.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {todos.map(todo => (
                <div
                  key={todo.id}
                  className="animate-todo-in"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px',
                    background: priorityBg[todo.priority],
                    border: `1px solid ${priorityBorder[todo.priority]}`,
                    borderRadius: '8px',
                    opacity: todo.status === 'completed' ? 0.5 : 1,
                  }}
                >
                  {/* Priority indicator */}
                  <div style={{
                    width: 3, height: '100%', minHeight: 20, borderRadius: '2px',
                    background: priorityColors[todo.priority],
                  }} />

                  {/* Checkbox */}
                  <button
                    onClick={() => onToggle(todo.id)}
                    style={{
                      background: todo.status === 'completed' ? priorityColors[todo.priority] : 'transparent',
                      border: `1.5px solid ${todo.status === 'completed' ? priorityColors[todo.priority] : '#556677'}`,
                      borderRadius: '4px', width: 18, height: 18,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, padding: 0,
                    }}
                  >
                    {todo.status === 'completed' && <Check size={11} color="#0a0e1a" strokeWidth={3} />}
                  </button>

                  {/* Text */}
                  <span style={{
                    flex: 1, fontSize: '12px', color: todo.status === 'completed' ? '#556677' : '#c8d0e0',
                    textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
                    wordBreak: 'break-word',
                  }}>
                    {todo.text}
                  </span>

                  {/* Delete */}
                  <button
                    onClick={() => onRemove(todo.id)}
                    style={{
                      background: 'none', border: 'none', color: '#3a4560',
                      cursor: 'pointer', padding: '2px', flexShrink: 0,
                      display: 'flex', alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add todo input */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(17,24,39,0.5)',
        }}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {(['high', 'medium', 'low'] as const).map(p => (
              <button
                key={p}
                onClick={() => setNewPriority(p)}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: '4px', fontSize: '10px',
                  fontWeight: 600,
                  background: newPriority === p ? priorityBg[p] : 'transparent',
                  border: `1px solid ${newPriority === p ? priorityBorder[p] : 'rgba(255,255,255,0.06)'}`,
                  color: newPriority === p ? priorityColors[p] : '#3a4560',
                  cursor: 'pointer', textTransform: 'uppercase',
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <div style={{
            display: 'flex', gap: '8px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px', padding: '6px 10px',
          }}>
            <input
              ref={inputRef}
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Add a task..."
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#e8edf5', fontSize: '12px', fontFamily: 'inherit', padding: 0,
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!newText.trim()}
              style={{
                background: newText.trim() ? 'linear-gradient(135deg, #00d4ff, #0088cc)' : 'rgba(255,255,255,0.04)',
                border: 'none', borderRadius: '6px', padding: '4px 10px',
                color: newText.trim() ? 'white' : '#3a4560',
                cursor: newText.trim() ? 'pointer' : 'default',
                fontSize: '11px', fontWeight: 600,
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MESSAGE BUBBLE
// ═══════════════════════════════════════════════

function MessageBubble({ msg, onCopy }: { msg: Message; onCopy: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    onCopy(msg.content);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexDirection: isUser ? 'row-reverse' : 'row' }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
        background: isUser ? 'linear-gradient(135deg, #ff6b2b, #ff8f5a)' : 'linear-gradient(135deg, #00d4ff, #0088cc)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isUser ? <User size={16} color="white" /> : <Bot size={16} color="white" />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, maxWidth: '85%', minWidth: 0 }}>
        {/* Thinking steps */}
        {msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
          <ThinkingDisplay steps={msg.thinkingSteps} isLive={false} elapsed={msg.thinkingTime} />
        )}

        {/* Message body */}
        <div style={{
          background: isUser ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: '12px',
          padding: '10px 14px',
          position: 'relative',
          wordBreak: 'break-word',
        }}>
          <div
            style={{ fontSize: '14px', lineHeight: 1.7, color: isUser ? '#e8edf5' : '#d0d8e8' }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />

          {/* Copy button & provider tag */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={handleCopy}
                style={{ background: 'none', border: 'none', color: '#556677', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px' }}
              >
                {copied ? <Check size={11} color="#00ff88" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              {msg.provider && (
                <span style={{ fontSize: '9px', color: '#556677', marginLeft: '4px' }}>
                  via {msg.provider}
                </span>
              )}
            </div>
            <span style={{ fontSize: '9px', color: '#3a4560' }}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

export default function JarvisApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [showProviders, setShowProviders] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── LOCALSTORAGE: TODOS ───
  useEffect(() => {
    try {
      const saved = localStorage.getItem('jarvis_todos_v7');
      if (saved) setTodos(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('jarvis_todos_v7', JSON.stringify(todos));
    } catch {}
  }, [todos]);

  // ─── THINKING TIMER ───
  useEffect(() => {
    if (isLoading && thinkingStartTime === null) {
      setThinkingStartTime(Date.now());
      setThinkingElapsed(0);
    }
  }, [isLoading, thinkingStartTime]);

  useEffect(() => {
    if (!thinkingStartTime || !isLoading) return;
    const interval = setInterval(() => {
      setThinkingElapsed(Date.now() - thinkingStartTime);
    }, 100);
    return () => clearInterval(interval);
  }, [thinkingStartTime, isLoading]);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, thinkingSteps, scrollToBottom]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  // Check online status
  useEffect(() => {
    const check = () => {
      fetch('/api/ping').then(r => r.ok ? setIsOnline(true) : setIsOnline(false)).catch(() => setIsOnline(false));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Copy handler
  const handleCopy = (text: string) => {
    toast.success('Copied to clipboard');
  };

  // Clear chat
  const clearChat = () => {
    setMessages([]);
    toast.success('Chat cleared');
  };

  // Todo handlers
  const handleToggleTodo = useCallback((id: string) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, status: t.status === 'pending' ? 'completed' as const : 'pending' as const } : t));
  }, []);

  const handleRemoveTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleAddTodo = useCallback((text: string, priority: 'high' | 'medium' | 'low') => {
    const todo: TodoItem = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text, priority, status: 'pending', createdAt: Date.now(),
    };
    setTodos(prev => [todo, ...prev]);
  }, []);

  // ═══════════════════════════════════════════════
  // SEND MESSAGE
  // ═══════════════════════════════════════════════

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Add user message
    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setThinkingSteps([]);
    setThinkingStartTime(null);
    setThinkingElapsed(0);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      if (!res.body) {
        throw new Error('No response body');
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentSteps: ThinkingStep[] = [];
      let finalReply = '';
      let finalProvider = '';
      let finalThinkingTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            switch (data.type) {
              case 'thinking':
                currentSteps = [...currentSteps, {
                  label: data.label,
                  detail: data.detail || '',
                  phase: data.phase,
                  duration: data.duration,
                }];
                setThinkingSteps([...currentSteps]);
                break;

              case 'action':
                currentSteps = [...currentSteps, {
                  label: data.label || `Action: ${data.phase}`,
                  detail: data.detail || '',
                  phase: data.phase || 'action',
                  duration: data.duration,
                }];
                setThinkingSteps([...currentSteps]);
                break;

              case 'result':
                currentSteps = [...currentSteps, {
                  label: data.label || `Result`,
                  detail: data.detail || '',
                  phase: data.phase || 'result',
                  duration: data.duration,
                }];
                setThinkingSteps([...currentSteps]);
                break;

              case 'error':
                currentSteps = [...currentSteps, {
                  label: data.label || 'Error',
                  detail: data.detail || '',
                  phase: data.phase || 'error',
                }];
                setThinkingSteps([...currentSteps]);
                break;

              case 'todo':
                if (data.action === 'add' && data.todo) {
                  const exists = todos.some(t => t.text === data.todo.text);
                  if (!exists) {
                    setTodos(prev => [{
                      id: data.todo.id || `todo_${Date.now()}`,
                      text: data.todo.text,
                      priority: data.todo.priority || 'medium',
                      status: data.todo.status || 'pending',
                      createdAt: Date.now(),
                    }, ...prev]);
                  }
                } else if (data.action === 'complete' && data.todo) {
                  setTodos(prev => prev.map(t => t.id === data.todo.id ? { ...t, status: 'completed' } : t));
                } else if (data.action === 'remove' && data.todo) {
                  setTodos(prev => prev.filter(t => t.id !== data.todo.id));
                }
                break;

              case 'knowledge':
                // Save knowledge to localStorage
                try {
                  const key = `jarvis_knowledge_${data.category || 'general'}`;
                  const existing = JSON.parse(localStorage.getItem(key) || '{}');
                  existing[data.key] = data.value;
                  localStorage.setItem(key, JSON.stringify(existing));
                } catch {}
                break;

              case 'done':
                finalReply = data.reply || '';
                finalProvider = data.provider || '';
                finalThinkingTime = data.thinkingTime || 0;
                break;

              case 'providers':
                setProviders(data.providers || []);
                break;
            }
          } catch {}
        }
      }

      // Add assistant message
      if (finalReply) {
        const totalTime = thinkingStartTime ? Date.now() - thinkingStartTime : finalThinkingTime;
        const assistantMsg: Message = {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: finalReply,
          timestamp: Date.now(),
          thinkingSteps: currentSteps.length > 0 ? currentSteps : undefined,
          thinkingTime: totalTime > 0 ? totalTime : undefined,
          provider: finalProvider,
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        toast.error('No response received');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setIsLoading(false);
      setThinkingSteps([]);
      setThinkingStartTime(null);
      inputRef.current?.focus();
    }
  };

  // Keyboard: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Fetch providers on mount
  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/ping');
      const data = await res.json();
      if (data.providers) setProviders(data.providers);
    } catch {}
  };

  useEffect(() => { fetchProviders(); }, []);

  const activeProviders = providers.filter(p => p.available && p.active).length;
  const pendingTodoCount = todos.filter(t => t.status === 'pending').length;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      <Toaster position="top-center" theme="dark" />

      {/* ═══ TODOS PANEL ═══ */}
      {showTodos && (
        <TodoPanel
          todos={todos}
          onClose={() => setShowTodos(false)}
          onToggle={handleToggleTodo}
          onRemove={handleRemoveTodo}
          onAdd={handleAddTodo}
        />
      )}

      {/* ═══ HEADER ═══ */}
      <header style={{
        flexShrink: 0,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(10,14,26,0.9)',
        backdropFilter: 'blur(10px)',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '8px',
            background: 'linear-gradient(135deg, #00d4ff, #0088cc)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '1px', color: '#e8edf5' }}>JARVIS</div>
            <div style={{ fontSize: '9px', color: '#556677', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isOnline ? <Wifi size={9} color="#00ff88" /> : <WifiOff size={9} color="#ff4444" />}
              {isOnline ? `${activeProviders} AI engines online` : 'Offline'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Todo button */}
          <button
            onClick={() => setShowTodos(true)}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px', padding: '6px 10px', color: '#8899b4', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
              position: 'relative',
            }}
          >
            <ListTodo size={12} />
            {pendingTodoCount > 0 && (
              <span style={{
                position: 'absolute', top: '-4px', right: '-4px',
                background: '#ff4444', color: 'white',
                fontSize: '9px', fontWeight: 700,
                width: '16px', height: '16px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>
                {pendingTodoCount > 9 ? '9+' : pendingTodoCount}
              </span>
            )}
          </button>

          {/* Providers toggle */}
          <button
            onClick={() => setShowProviders(!showProviders)}
            style={{
              background: showProviders ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showProviders ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: '8px', padding: '6px 10px', color: '#8899b4', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
            }}
          >
            <Globe size={12} />
            <ChevronDown size={10} style={{ transform: showProviders ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {/* Clear chat */}
          <button
            onClick={clearChat}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '8px', padding: '6px 10px', color: '#8899b4', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </header>

      {/* ═══ PROVIDERS PANEL ═══ */}
      {showProviders && (
        <div className="animate-fade-in" style={{
          flexShrink: 0,
          padding: '10px 16px',
          background: 'rgba(17,24,39,0.95)',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{ fontSize: '10px', color: '#556677', marginBottom: '6px', fontWeight: 600, letterSpacing: '0.5px' }}>AI ENGINE STATUS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {providers.length > 0 ? providers.map(p => (
              <div key={p.name} style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '10px',
                background: p.available && p.active ? 'rgba(0,255,136,0.08)' : 'rgba(255,68,68,0.06)',
                border: `1px solid ${p.available && p.active ? 'rgba(0,255,136,0.2)' : 'rgba(255,68,68,0.1)'}`,
                color: p.available && p.active ? '#00ff88' : '#ff4444',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.available && p.active ? '#00ff88' : '#ff4444' }} />
                {p.name}
              </div>
            )) : (
              <span style={{ fontSize: '10px', color: '#556677' }}>Loading engine status...</span>
            )}
          </div>
        </div>
      )}

      {/* ═══ MESSAGES ═══ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: '8px' }}>
        {messages.length === 0 && !isLoading ? (
          <div style={{
            height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: '#3a4560',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(0,212,255,0.1), rgba(255,107,43,0.06))',
              border: '1px solid rgba(0,212,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '16px',
            }}>
              <Bot size={32} color="#00d4ff" style={{ opacity: 0.6 }} />
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#556677', marginBottom: '6px' }}>JARVIS AI v11</div>
            <div style={{ fontSize: '12px', color: '#3a4560', textAlign: 'center', maxWidth: '260px', lineHeight: 1.6 }}>
              Autonomous AI agent — deep reasoning, never gives up, self-improving via GitHub.
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {['Deep Reasoning', 'Never Gives Up', 'Self-Improving', 'Multi-Provider'].map(tag => (
                <span key={tag} style={{
                  fontSize: '10px', padding: '4px 10px', borderRadius: '12px',
                  background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.1)',
                  color: '#556677',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} onCopy={handleCopy} />
          ))
        )}

        {/* Live thinking display */}
        {isLoading && thinkingSteps.length > 0 && (
          <ThinkingDisplay steps={thinkingSteps} isLive={true} elapsed={thinkingElapsed} />
        )}

        {/* Loading indicator (no thinking steps yet) */}
        {isLoading && thinkingSteps.length === 0 && (
          <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
              background: 'linear-gradient(135deg, #00d4ff, #0088cc)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={16} color="white" />
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px', padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="animate-pulse-dot"
                    style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                      background: '#00d4ff', animationDelay: `${i * 0.3}s`,
                    }}
                  />
                ))}
                <span style={{ fontSize: '12px', color: '#556677', marginLeft: '6px' }}>JARVIS is thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ═══ INPUT AREA ═══ */}
      <div style={{
        flexShrink: 0,
        padding: '12px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--border-color)',
        background: 'rgba(10,14,26,0.95)',
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: '8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '14px',
          padding: '8px 12px',
          transition: 'border-color 0.2s',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask JARVIS anything..."
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#e8edf5', fontSize: '14px', lineHeight: 1.5, resize: 'none',
              fontFamily: 'inherit', maxHeight: '120px', minHeight: '20px',
              padding: '0',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            style={{
              width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
              background: input.trim() && !isLoading
                ? 'linear-gradient(135deg, #00d4ff, #0088cc)'
                : 'rgba(255,255,255,0.04)',
              border: 'none', cursor: input.trim() && !isLoading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
          >
            {isLoading ? (
              <Loader2 size={16} color="#00d4ff" style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Send size={16} color={input.trim() ? 'white' : '#3a4560'} />
            )}
          </button>
        </div>
        <div style={{
          textAlign: 'center', fontSize: '9px', color: '#2a3550', marginTop: '8px',
        }}>
          JARVIS v11.0 — Personal Model + Smart Agent — Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
