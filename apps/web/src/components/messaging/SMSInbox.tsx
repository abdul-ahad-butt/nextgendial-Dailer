import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { formatE164 } from '../../utils/formatters';

export interface SMSMessage {
  id: string;
  tenant_id: string;
  from_number: string;
  to_number: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  agent_id?: string;
  created_at: string;
}

interface SMSInboxProps {
  isOpen: boolean;
  onClose: () => void;
  targetPhoneNumber?: string;
  onDial?: (phoneNumber: string) => void;
}

export const SMSInbox: React.FC<SMSInboxProps> = ({
  isOpen,
  onClose,
  targetPhoneNumber,
  onDial,
}) => {
  const [phoneNumber, setPhoneNumber] = useState(targetPhoneNumber || '');
  const [messages, setMessages] = useState<SMSMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [outgoingText, setOutgoingText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (targetPhoneNumber) {
      setPhoneNumber(targetPhoneNumber);
    }
  }, [targetPhoneNumber]);

  const fetchMessages = async (phone: string) => {
    if (!phone) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.messages.list({ phone_number: phone, limit: 50 });
      setMessages(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && phoneNumber) {
      fetchMessages(phoneNumber);
      const interval = setInterval(() => {
        fetchMessages(phoneNumber);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, phoneNumber]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outgoingText.trim() || !phoneNumber.trim()) return;

    try {
      setSending(true);
      setError(null);
      await api.messages.send({
        to: phoneNumber,
        body: outgoingText.trim(),
      });
      setOutgoingText('');
      await fetchMessages(phoneNumber);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch SMS');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div className="relative w-full max-w-lg h-full bg-[#0E131F]/95 border-l border-slate-800 shadow-2xl flex flex-col animate-slide-in">
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {phoneNumber ? `SMS: ${formatE164(phoneNumber)}` : 'Two-Way Messaging'}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-slate-400">Inbound & Outbound SMS</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-md">
                  $0.0075 / SMS
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contact Input / Dial bar */}
        <div className="p-3 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Enter phone number (+1...)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            onClick={() => fetchMessages(phoneNumber)}
            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors"
          >
            Load
          </button>
          {onDial && phoneNumber && (
            <button
              onClick={() => {
                onDial(phoneNumber);
                onClose();
              }}
              title="Quick Call"
              className="p-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-all shadow-md active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
          )}
        </div>

        {error && (
          <div className="mx-3 mt-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!phoneNumber ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
              <p className="text-xs">Enter a customer phone number above to start chatting.</p>
            </div>
          ) : loading && messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-xs">
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
              <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 mb-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-xs font-medium text-slate-300">No message history</p>
              <p className="text-[11px] text-slate-500 mt-1">Send an SMS below to initiate contact.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOutbound = msg.direction === 'outbound';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[82%] p-3 rounded-2xl text-xs ${
                      isOutbound
                        ? 'bg-emerald-600 text-slate-50 rounded-br-none shadow-md shadow-emerald-950/40'
                        : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60'
                    }`}
                  >
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 px-1 text-[10px] text-slate-500 font-mono">
                    <span>{isOutbound ? 'Sent' : 'Received'}</span>
                    <span>•</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center gap-2">
          <input
            type="text"
            placeholder="Type your message..."
            value={outgoingText}
            onChange={(e) => setOutgoingText(e.target.value)}
            disabled={!phoneNumber || sending}
            className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!phoneNumber || !outgoingText.trim() || sending}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {sending ? (
              <span>Sending...</span>
            ) : (
              <>
                <span>Send</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
