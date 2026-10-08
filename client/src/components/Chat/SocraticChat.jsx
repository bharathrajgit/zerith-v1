import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getChat, sendMessage } from '../../services/chatService';

const formatTime = (value) => {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const createGreeting = (title) => {
  const safeTitle = title || 'this problem';
  return `Hey! Ready to tackle ${safeTitle}? Before we start — what's the first thing you notice about this problem?`;
};

const panelStyle = {
  width: '400px',
  maxWidth: 'calc(100vw - 32px)',
  minHeight: '560px',
  background: '#f5f7fb',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: '18px',
  boxShadow: '0 30px 60px rgba(15, 23, 42, 0.18)',
  overflow: 'hidden',
  position: 'relative',
};

const buttonStyle = {
  width: '68px',
  height: '68px',
  borderRadius: '50%',
  border: 'none',
  background: 'linear-gradient(135deg, #8b5cf6 0%, #4f46e5 100%)',
  boxShadow: '0 16px 28px rgba(79, 70, 229, 0.38)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const chatKeyframes = `
  @keyframes chatPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.18); opacity: 0.8; }
  }
`;

export default function SocraticChat({ problemId, problemType = 'practice', getCurrentCode }) {
  const messageContainerRef = useRef(null);
  const textareaRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (messageContainerRef.current) {
        messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
      }
    });
  };

  const loadChatHistory = async () => {
    if (!problemId) return;

    try {
      const response = await getChat(problemId, problemType);
      const history = response?.data?.data?.messages || [];

      if (history.length === 0) {
        const initialMessage = {
          role: 'assistant',
          content: createGreeting(response?.data?.data?.problem?.title || 'this problem'),
          timestamp: new Date().toISOString(),
        };

        setMessages([initialMessage]);
        setUnreadCount(1);
        return;
      }

      const normalizedMessages = history.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp || new Date().toISOString(),
      }));

      setMessages(normalizedMessages);
    } catch (error) {
      setMessages([{
        role: 'assistant',
        content: 'I’m having trouble loading the chat right now. Try again in a moment.',
        timestamp: new Date().toISOString(),
      }]);
    }
  };

  useEffect(() => {
    loadChatHistory();
  }, [problemId, problemType]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      textareaRef.current?.focus();
      setUnreadCount(0);
    }
  }, [isOpen]);

  const handleSend = async () => {
    const trimmedMessage = inputText.trim();
    const currentCode = typeof getCurrentCode === 'function' ? getCurrentCode() : '';

    if (!trimmedMessage && !currentCode.trim()) {
      toast.error('Type a message or write some code first');
      return;
    }

    if (!problemId) {
      toast.error('Problem context is missing');
      return;
    }

    const userMessage = {
      role: 'user',
      content: trimmedMessage || `Current code:\n${currentCode}`,
      timestamp: new Date().toISOString(),
    };

    const optimisticMessages = [...messages, userMessage];
    setMessages(optimisticMessages);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await sendMessage(problemId, trimmedMessage, currentCode, problemType);
      const assistantReply = response?.data?.data?.reply || 'I’m having trouble thinking right now. Try again in a moment!';
      const assistantMessage = {
        role: 'assistant',
        content: assistantReply,
        timestamp: new Date().toISOString(),
      };

      setMessages([...optimisticMessages, assistantMessage]);
    } catch (error) {
      setMessages([...optimisticMessages, {
        role: 'assistant',
        content: 'I’m having trouble thinking right now. Try again in a moment!',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <style>{chatKeyframes}</style>
      <div style={{ position: 'fixed', right: '22px', bottom: '22px', zIndex: 1000 }}>
        {!isOpen ? (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label="Open Socratic chat"
            style={{ ...buttonStyle, position: 'relative', animation: 'chatPulse 1.8s ease-in-out infinite' }}
          >
            <MessageCircle size={30} color="#ffffff" strokeWidth={2.2} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute',
                right: '4px',
                top: '4px',
                minWidth: '18px',
                height: '18px',
                borderRadius: '999px',
                background: '#ef4444',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 5px',
              }}>
                {unreadCount}
              </span>
            )}
          </button>
        ) : (
          <div style={panelStyle}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '18px 18px 14px',
              background: 'linear-gradient(180deg, rgba(15,23,42,0.95), rgba(15,23,42,0.9))',
              borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
            }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', lineHeight: 1.2 }}>
                  ZAI — Your thinking partner
                </div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#a5b4cf' }}>
                  I won’t give you the code — but I’ll help you find it
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close chat"
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(148, 163, 184, 0.08)',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div ref={messageContainerRef} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              height: '440px',
              overflowY: 'auto',
              padding: '16px 14px',
              background: '#eff4fb',
            }}>
              {messages.map((message, index) => {
                const isUser = message.role === 'user';
                return (
                  <div key={`${message.role}-${index}-${message.timestamp}`} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '85%',
                      borderRadius: isUser ? '18px 18px 18px 6px' : '18px 18px 6px 18px',
                      padding: '10px 12px 8px',
                      background: isUser ? 'linear-gradient(135deg, #8b5cf6, #4f46e5)' : '#ffffff',
                      color: isUser ? '#ffffff' : '#0f172a',
                      boxShadow: isUser ? '0 10px 18px rgba(79,70,229,0.18)' : '0 6px 18px rgba(15, 23, 42, 0.05)',
                    }}>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.6, wordBreak: 'break-word' }}>
                        {message.content}
                      </div>
                      <div style={{
                        marginTop: '4px',
                        fontSize: '10px',
                        opacity: isUser ? 0.82 : 0.6,
                        textAlign: 'right',
                      }}>
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    borderRadius: '18px 18px 6px 18px',
                    background: '#ffffff',
                    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.05)',
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block', animation: 'chatPulse 1.1s ease-in-out infinite' }} />
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block', animation: 'chatPulse 1.1s ease-in-out infinite 0.15s' }} />
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block', animation: 'chatPulse 1.1s ease-in-out infinite 0.3s' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 14px 14px',
              background: '#eef2f9',
              borderTop: '1px solid rgba(148,163,184,0.2)',
            }}>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask ZAI anything..."
                disabled={isLoading}
                style={{
                  width: '100%',
                  resize: 'none',
                  borderRadius: '12px',
                  border: '1px solid rgba(148, 163, 184, 0.9)',
                  background: '#ffffff',
                  color: '#0f172a',
                  padding: '10px 12px',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', gap: '12px' }}>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #4f46e5 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.7 : 1,
                    boxShadow: '0 12px 18px rgba(79,70,229,0.24)',
                  }}
                >
                  <Send size={16} />
                  Send
                </button>

                <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'right', lineHeight: 1.5 }}>
                  ZAI never gives code — only questions that make you think
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
