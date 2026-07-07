import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, Users, Terminal, Settings as SettingsIcon, 
  Sparkles, ShieldAlert, Radio, Shield, 
  Activity as ActivityIcon, Search, CheckCircle, Mail, Ban, NotepadText,
  Plus, Edit2, Trash2, Server, Send, CheckCircle2, Clock, 
  User, MessageCircleCode, Gift, Timer, Film, Scissors, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

// ==========================================
// TYPES & MOCK DATA
// ==========================================
export interface Product {
  id: string;
  name: string;
  price: string;
  link: string;
  category: string;
  stock: string;
  desc?: string;
  upsellId?: string;
  upsellDiscount?: number;
}

export interface Transaction {
  id: string;
  date: string;
  username: string;
  product: string;
  price: number;
}

export interface Activity {
  type: 'sale' | 'join' | 'leave' | 'ticket' | 'review' | 'system';
  message: string;
  time: number;
}

export interface CustomRequest {
  id: string;
  username: string;
  userId: string;
  product: string;
  date: string;
  status: 'pending' | 'recording' | 'editing' | 'done';
}

export interface Member {
  id: string;
  username: string;
  joinedAt: string;
  joinedTimestamp: number;
  createdAt: string;
  avatar: string;
  totalSpent: number;
  note: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  isBlacklisted: boolean;
  warns: { reason: string; date: string }[];
  activeTickets: { id: string; name: string }[];
}

export interface Review {
  id: string;
  userId: string;
  username: string;
  product: string;
  rating: number;
  text: string;
  date: string;
}

export interface PromoCode {
  code: string;
  discount: number;
  limit: number;
  used: number;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  name: string;
  userAvatar?: string;
  messages: {
    id: string;
    author: string;
    isBot: boolean;
    content: string;
    timestamp: number;
    imageUrl?: string;
  }[];
}

const INITIAL_PRODUCTS: Product[] = [
  { id: "1", name: "Photo Pack 1", price: "5", link: "https://drive.google.com/drive/folders/pack1_demo", category: "✨ PHOTOS", stock: "∞", desc: "Premium high-resolution photo set including high-key editorial captures.", upsellId: "6", upsellDiscount: 20 },
  { id: "2", name: "Photo Pack 2", price: "5", link: "https://drive.google.com/drive/folders/pack2_demo", category: "✨ PHOTOS", stock: "∞", desc: "Atmospheric street style capture catalog in high density print formats." },
  { id: "3", name: "Full Body Capture", price: "5", link: "https://drive.google.com/drive/folders/pack3_demo", category: "✨ PHOTOS", stock: "∞", desc: "Studio lighting setup capturing detailed movement and forms." },
  { id: "4", name: "Try-On Pack", price: "5", link: "https://drive.google.com/drive/folders/pack4_demo", category: "✨ PHOTOS", stock: "15", desc: "Fashion catalogue styling and apparel modeling showcases." },
  { id: "6", name: "5-Min Video Content", price: "10", link: "https://drive.google.com/file/d/video5_demo", category: "🔥 VIDEOS", stock: "∞", desc: "4K cinematic video journal featuring behind-the-scenes workflow.", upsellId: "8", upsellDiscount: 15 },
  { id: "7", name: "Shower / Bath Vlog", price: "10", link: "https://drive.google.com/file/d/video7_demo", category: "🔥 VIDEOS", stock: "5", desc: "Artistic, high-concept visual story emphasizing fluid dynamics and mist." },
  { id: "8", name: "Friends Pack Special", price: "15", link: "https://drive.google.com/drive/folders/pack8_demo", category: "💦 SPECIAL", stock: "∞", desc: "Exclusive collaboration session featuring dynamic group aesthetics." },
  { id: "VIP", name: "👑 VIP Pass (30 Days)", price: "20", link: "Welcome to VIP!", category: "👑 SUBSCRIPTION", stock: "∞", desc: "All-access digital pass to private discord archives and exclusive discounts." }
];

const INITIAL_BUY_LINKS = [
  { id: "1", label: "💳 Buy €5 Voucher", url: "https://www.eneba.com/rewarble-rewarble-revolut-5-gbp-voucher-global" },
  { id: "2", label: "💳 Buy €10 Voucher", url: "https://www.eneba.com/rewarble-rewarble-revolut-10-gbp-voucher-global" },
  { id: "3", label: "💳 Buy €15 Voucher", url: "https://www.eneba.com/rewarble-rewarble-revolut-15-gbp-voucher-global" },
  { id: "4", label: "💳 Buy €20 Voucher", url: "https://www.eneba.com/rewarble-rewarble-revolut-20-gbp-voucher-global" }
];

const INITIAL_MEMBERS: Member[] = [
  { id: "1520551977854042114", username: "AlexG", joinedAt: "06/15/2026", joinedTimestamp: 1781513900000, createdAt: "03/12/2021", avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=AlexG", totalSpent: 45, note: "VIP Buyer. Enjoys physical aesthetic styles.", status: "online", isBlacklisted: false, warns: [], activeTickets: [] },
  { id: "2849204910249204921", username: "ShadowBlade", joinedAt: "06/20/2026", joinedTimestamp: 1781945900000, createdAt: "10/05/2023", avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=Shadow", totalSpent: 10, note: "Requested custom video sequence.", status: "idle", isBlacklisted: false, warns: [{ reason: "Self-promotion", date: "06/21/2026" }], activeTickets: [{ id: "shop-shadowblade", name: "shop-shadowblade" }] },
  { id: "9284102941029412093", username: "HyperX", joinedAt: "07/01/2026", joinedTimestamp: 1782896300000, createdAt: "01/18/2024", avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=HyperX", totalSpent: 20, note: "Frequent customer.", status: "dnd", isBlacklisted: false, warns: [], activeTickets: [] },
  { id: "3819204910249201940", username: "Lumiere", joinedAt: "06/28/2026", joinedTimestamp: 1782637100000, createdAt: "07/22/2022", avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=Lumiere", totalSpent: 5, note: "Interests: Mirror aesthetics.", status: "offline", isBlacklisted: false, warns: [], activeTickets: [{ id: "support-lumiere", name: "support-lumiere" }] }
];

const INITIAL_CUSTOM_REQUESTS: CustomRequest[] = [
  { id: "cr-1", username: "AlexG", userId: "1520551977854042114", product: "Encrypted Mirror Sequence Model #B", date: "2026-07-06, 2:15 PM", status: "pending" },
  { id: "cr-2", username: "ShadowBlade", userId: "2849204910249204921", product: "Vintage Polaroid Full Set", date: "2026-07-06, 12:40 PM", status: "recording" },
  { id: "cr-3", username: "HyperX", userId: "9284102941029412093", product: "Summer Outfit try-on video vlog (10m)", date: "2026-07-05, 9:11 PM", status: "editing" }
];

const INITIAL_PROMOS: PromoCode[] = [
  { code: "GOYAVE5", discount: 5, limit: 10, used: 2, createdAt: "07/01/2026" },
  { code: "BENTO99", discount: 99, limit: 1, used: 0, createdAt: "07/06/2026" },
  { code: "WELCOME20", discount: 20, limit: 100, used: 45, createdAt: "06/01/2026" }
];

const INITIAL_ACTIVITIES: Activity[] = [
  { type: "sale", message: "💰 €10 Sale: ShadowBlade bought 5-Min Video Content", time: Date.now() - 25 * 60 * 1000 },
  { type: "ticket", message: "🎫 New shop ticket opened by ShadowBlade", time: Date.now() - 40 * 60 * 1000 },
  { type: "review", message: "⭐ New 5/5 review submitted by Lumiere", time: Date.now() - 2 * 3600 * 1000 },
  { type: "join", message: "👋 GoyaveFan joined the server", time: Date.now() - 3.5 * 3600 * 1000 }
];

const INITIAL_TICKETS: SupportTicket[] = [
  {
    id: "shop-shadowblade",
    name: "shop-shadowblade",
    userAvatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=Shadow",
    messages: [
      { id: "m1", author: "ShadowBlade", isBot: false, content: "Hello! I am ready to redeem. I got my voucher from Eneba.", timestamp: Date.now() - 40 * 60 * 1000 },
      { id: "m2", author: "Nexus Bot", isBot: true, content: "👋 Welcome! Please paste your Rewarble voucher code or Promo Code below.", timestamp: Date.now() - 39 * 60 * 1000 },
      { id: "m3", author: "ShadowBlade", isBot: false, content: "Here is the code: REW-REVOLUT-88219-X92A", timestamp: Date.now() - 38 * 60 * 1000 },
      { id: "m4", author: "Nexus Bot", isBot: true, content: "✅ Code validated! Value detected: €10. Please select an item you can afford below:", timestamp: Date.now() - 37 * 60 * 1000 }
    ]
  },
  {
    id: "support-lumiere",
    name: "support-lumiere",
    userAvatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=Lumiere",
    messages: [
      { id: "m10", author: "Lumiere", isBot: false, content: "Hi admin, do you have any active bundle offers?", timestamp: Date.now() - 2 * 3600 * 1000 },
      { id: "m11", author: "System", isBot: true, content: "🎧 Support ticket initialized. An admin has been notified.", timestamp: Date.now() - 1.9 * 3600 * 1000 }
    ]
  }
];

const INITIAL_REVIEWS: Review[] = [
  { id: "rev-1", userId: "3819204910249201940", username: "Lumiere", product: "Full Body Capture", rating: 5, text: "Absolutely stunning captures. Pristine resolution.", date: "07/06/2026, 1:40 PM" },
  { id: "rev-2", userId: "1520551977854042114", username: "AlexG", product: "Surprise Gift Pack", rating: 4, text: "Excellent variety of polaroids!", date: "07/05/2026, 8:22 PM" }
];

const MOCK_USER_REPLIES: Record<string, string[]> = {
  "shop-shadowblade": [
    "Awesome! I've selected the 5-Min Video Content. Please deliver it to my direct messages.",
    "Wow, that was fast! I just received it in my DMs! Thank you so much!",
    "Definitely going to leave a 5-star review, amazing setup."
  ],
  "support-lumiere": [
    "Thank you for responding. I would love a promo code if you can share one!",
    "That welcome discount works perfectly! I will redeem it right away."
  ]
};

// ==========================================
// SUBCOMPONENTS
// ==========================================

function TemporalChart() {
  const chartData = [
    { time: '00:00', revenue: 15, tickets: 2 },
    { time: '03:00', revenue: 5, tickets: 1 },
    { time: '06:00', revenue: 20, tickets: 4 },
    { time: '09:00', revenue: 45, tickets: 8 },
    { time: '12:00', revenue: 85, tickets: 12 },
    { time: '15:00', revenue: 110, tickets: 18 },
    { time: '18:00', revenue: 75, tickets: 10 },
    { time: '21:00', revenue: 50, tickets: 6 },
    { time: '24:00', revenue: 30, tickets: 3 },
  ];
  return (
    <div className="w-full h-full min-h-[140px] relative">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} />
          <YAxis stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5', fontSize: '11px', fontFamily: 'JetBrains Mono' }} />
          <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name="Revenue (€)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DowChart() {
  const dowData = [
    { day: 'Mon', sales: 45 }, { day: 'Tue', sales: 80 }, { day: 'Wed', sales: 55 },
    { day: 'Thu', sales: 90 }, { day: 'Fri', sales: 150 }, { day: 'Sat', sales: 210 }, { day: 'Sun', sales: 180 },
  ];
  return (
    <div className="w-full h-full min-h-[140px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dowData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <XAxis dataKey="day" stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} />
          <YAxis stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5', fontSize: '11px', fontFamily: 'JetBrains Mono' }} />
          <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} name="Sales (€)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryRevenueChart() {
  const categoryData = [
    { name: 'Photos', value: 450, color: '#10b981' },
    { name: 'Videos', value: 380, color: '#a855f7' },
    { name: 'Special', value: 180, color: '#d946ef' },
    { name: 'Subs', value: 240, color: '#38bdf8' },
  ];
  return (
    <div className="w-full h-full min-h-[140px] flex items-center justify-center">
      <div className="w-[50%] h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={categoryData} cx="50%" cy="50%" innerRadius={28} outerRadius={46} paddingAngle={4} dataKey="value">
              {categoryData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5', fontSize: '11px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-[50%] flex flex-col justify-center gap-1 text-[10px] font-mono">
        {categoryData.map((item, index) => (
          <div key={index} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-zinc-400 truncate max-w-[50px]">{item.name}</span>
            <span className="text-zinc-200 ml-auto">€{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelChart() {
  const funnelData = [
    { name: 'Total Visits', count: 1248, fill: '#27272a' },
    { name: 'Tickets Opened', count: 482, fill: '#a855f7' },
    { name: 'Redeem Input', count: 320, fill: '#38bdf8' },
    { name: 'Successful Sales', count: 284, fill: '#10b981' },
  ];
  return (
    <div className="w-full h-full min-h-[140px] flex flex-col gap-1.5 justify-center py-1">
      {funnelData.map((step, idx) => {
        const percent = Math.round((step.count / funnelData[0].count) * 100);
        return (
          <div key={idx} className="flex flex-col gap-0.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>{step.name}</span>
              <span>{step.count} ({percent}%)</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-950 border border-zinc-900 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${percent}%`, backgroundColor: step.fill }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionTerminal({ onAddActivity }: { onAddActivity: (msg: string) => void }) {
  const [logs, setLogs] = useState<string[]>([
    'SHELL: system_vitals_v4.8 active',
    'STATUS: Standby. Ready for optimize_nodes'
  ]);
  const [isScanning, setIsScanning] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);

  const runScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setLogs((prev) => [...prev, '⚡ Initiating node diagnostics scan...']);
    setTimeout(() => { setLogs((prev) => [...prev, '📡 Verifying Redis Upstash cluster: Nominal (12ms)']); }, 600);
    setTimeout(() => { setLogs((prev) => [...prev, '💳 Testing Rewarble checkout node: Status 200 OK']); }, 1200);
    setTimeout(() => {
      const generatedLatency = Math.floor(Math.random() * 45) + 8;
      setLatency(generatedLatency);
      setLogs((prev) => [
        ...prev,
        `🚀 End-to-End Latency: ${generatedLatency}ms. Status: Optimal.`,
        '🟢 SCAN COMPLETE: No anomalies detected.'
      ]);
      setIsScanning(false);
      onAddActivity(`🖥️ Diagnostics check complete: latency ${generatedLatency}ms`);
    }, 1800);
  };

  const clearLogs = () => {
    setLogs(['SHELL: Cleared context logs.', 'STATUS: Standby.']);
    setLatency(null);
  };

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-mono text-zinc-500 flex items-center gap-1">
          <Terminal size={11} className="text-emerald-500 animate-pulse" />
          CMD_SHELL: system_vitals
        </span>
        <span className={`px-1.5 py-0.5 border text-[9px] rounded font-mono ${isScanning ? 'border-amber-500/30 text-amber-500 animate-pulse' : 'border-emerald-500/30 text-emerald-500'}`}>
          {isScanning ? 'RUNNING' : 'ONLINE'}
        </span>
      </div>
      <div className="bg-zinc-950 rounded-xl p-2 border border-zinc-800 font-mono text-[11px] flex-1 my-2 max-h-[100px] overflow-y-auto flex flex-col gap-0.5 text-emerald-400">
        {logs.map((log, index) => (
          <div key={index} className="flex gap-1">
            <span className="text-zinc-600 select-none">&gt;</span>
            <span className={log.includes('🟢') || log.includes('Optimal') ? 'text-emerald-300' : log.includes('⚡') ? 'text-amber-300' : ''}>{log}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <button onClick={runScan} disabled={isScanning} className="bg-zinc-100 hover:bg-white text-zinc-950 font-bold py-1.5 px-3 rounded-lg text-[11px] flex items-center justify-center gap-1 transition-all active:scale-[0.98] disabled:opacity-55 cursor-pointer">
          Run Diagnostics
        </button>
        <button onClick={clearLogs} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-1.5 px-3 rounded-lg text-[11px] border border-zinc-700 flex items-center justify-center gap-1 transition-all active:scale-[0.98] cursor-pointer">
          Clear Console
        </button>
      </div>
    </div>
  );
}

function ChatBento({ onAddActivity, activeTicketsCount, setActiveTicketsCount }: { onAddActivity: (msg: string) => void, activeTicketsCount: number, setActiveTicketsCount: React.Dispatch<React.SetStateAction<number>> }) {
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_TICKETS);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("shop-shadowblade");
  const [inputText, setInputText] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeTicket = tickets.find(t => t.id === selectedTicketId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTicket?.messages, isTyping]);

  useEffect(() => {
    setActiveTicketsCount(tickets.length);
  }, [tickets, setActiveTicketsCount]);

  const handleSendMessage = (textToSend: string) => {
    if (!textToSend.trim() && !imageUrl) return;
    const newMsg = { id: `m-${Date.now()}`, author: 'Admin (You)', isBot: true, content: textToSend, timestamp: Date.now(), imageUrl: imageUrl || undefined };
    setTickets(prev => prev.map(t => t.id === selectedTicketId ? { ...t, messages: [...t.messages, newMsg] } : t));
    setInputText("");
    setImageUrl("");
    setIsTyping(true);
    const clientName = selectedTicketId.includes('shadowblade') ? 'ShadowBlade' : 'Lumiere';
    setTimeout(() => {
      setIsTyping(false);
      const possibleReplies = MOCK_USER_REPLIES[selectedTicketId] || ["Thanks for the support! This works great.", "Understood, looking into details now."];
      const randomReply = possibleReplies[Math.floor(Math.random() * possibleReplies.length)];
      const clientReply = { id: `m-${Date.now() + 1}`, author: clientName, isBot: false, content: randomReply, timestamp: Date.now() };
      setTickets(prev => prev.map(t => t.id === selectedTicketId ? { ...t, messages: [...t.messages, clientReply] } : t));
      onAddActivity(`💬 Support Chat: ${clientName} replied to your message`);
    }, 2000);
  };

  const sendQuickResponse = (type: string) => {
    let msg = '';
    if (type === 'welcome') msg = '👋 Hello! Welcome to Premium Support. How can we assist you today?';
    else if (type === 'wait') msg = '⏳ An administrative specialist is actively auditing your request. Please wait 3-5 minutes.';
    else if (type === 'resolved') msg = '✅ Has your issue been fully resolved? Let us know if you need anything else!';
    if (msg) handleSendMessage(msg);
  };

  const closeTicket = () => {
    if (!activeTicket) return;
    const clientName = selectedTicketId.includes('shadowblade') ? 'ShadowBlade' : 'Lumiere';
    onAddActivity(`🔒 Comms closed: support channel for ${clientName} severed successfully`);
    setTickets(prev => prev.filter(t => t.id !== selectedTicketId));
    const remaining = tickets.filter(t => t.id !== selectedTicketId);
    setSelectedTicketId(remaining.length > 0 ? remaining[0].id : "");
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-full min-h-[400px]">
      <div className="col-span-1 bg-zinc-950 rounded-2xl p-4 border border-zinc-900 flex flex-col gap-2">
        <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">Active Channels</h3>
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[300px]">
          {tickets.length === 0 ? <p className="text-zinc-500 text-xs text-center italic py-6">All queues cleared.</p> : (
            tickets.map(t => {
              const isActive = t.id === selectedTicketId;
              return (
                <button key={t.id} onClick={() => setSelectedTicketId(t.id)} className={`w-full text-left p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${isActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold' : 'bg-zinc-900/50 border-zinc-800/80 text-zinc-400 hover:text-zinc-200'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                  <span className="text-[11px] font-mono truncate">#{t.name}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="col-span-1 md:col-span-3 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col justify-between overflow-hidden relative">
        {activeTicket ? (
          <>
            <div className="p-3 bg-zinc-950 border-b border-zinc-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <img src={activeTicket.userAvatar} className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700" alt="avatar" />
                <h4 className="text-xs font-bold text-zinc-100 font-mono">#{activeTicket.name}</h4>
              </div>
              <button onClick={closeTicket} className="p-1.5 hover:bg-red-500/10 hover:text-red-400 text-zinc-500 rounded-lg border border-transparent cursor-pointer"><Trash2 size={14} /></button>
            </div>
            <div className="flex-1 p-3 overflow-y-auto max-h-[220px] min-h-[160px] flex flex-col gap-3 bg-zinc-950/10">
              {activeTicket.messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col max-w-[80%] ${msg.isBot ? 'self-end items-end' : 'self-start items-start'}`}>
                  <span className="text-[9px] font-mono text-zinc-500 mb-0.5">{msg.author}</span>
                  <div className={`p-2 rounded-xl text-[11px] leading-relaxed ${msg.isBot ? 'bg-emerald-500 text-zinc-950 font-medium' : 'bg-zinc-900 border border-zinc-800 text-zinc-100'}`}>{msg.content}</div>
                </div>
              ))}
              {isTyping && <div className="self-start flex gap-1 p-2 bg-zinc-900 rounded-xl"><span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" /></div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex flex-col gap-2">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button onClick={() => sendQuickResponse('welcome')} className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-300 hover:text-white cursor-pointer">👋 Welcome</button>
                <button onClick={() => sendQuickResponse('wait')} className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-300 hover:text-white cursor-pointer">⏳ Wait</button>
                <button onClick={() => sendQuickResponse('resolved')} className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-300 hover:text-white cursor-pointer">✅ Resolved</button>
              </div>
              <div className="flex gap-2">
                <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSendMessage(inputText)} placeholder="Type a message..." className="flex-1 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-[11px] text-zinc-200 outline-none" />
                <button onClick={() => handleSendMessage(inputText)} className="p-1.5 bg-emerald-500 text-zinc-950 rounded-lg hover:bg-emerald-400 transition-all cursor-pointer"><Send size={14} /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center gap-2 p-6 text-center text-zinc-500">
            <MessageCircleCode size={40} className="text-zinc-700 animate-pulse" />
            <p className="text-xs">No active live communication feeds require immediate audit.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanBento({ onAddActivity }: { onAddActivity: (msg: string) => void }) {
  const [requests, setRequests] = useState<CustomRequest[]>(INITIAL_CUSTOM_REQUESTS);

  const moveStatus = (id: string, currentStatus: CustomRequest['status']) => {
    let nextStatus: CustomRequest['status'] | null = null;
    if (currentStatus === 'pending') nextStatus = 'recording';
    else if (currentStatus === 'recording') nextStatus = 'editing';
    else if (currentStatus === 'editing') nextStatus = 'done';
    if (!nextStatus) return;
    setRequests(prev => prev.map(r => {
      if (r.id === id) {
        onAddActivity(`📋 Custom Kanban: "${r.product}" shifted to ${nextStatus.toUpperCase()}`);
        return { ...r, status: nextStatus as CustomRequest['status'] };
      }
      return r;
    }));
  };

  const columns: { key: CustomRequest['status']; title: string; color: string; border: string }[] = [
    { key: 'pending', title: '📬 NEW', color: 'text-amber-400', border: 'border-amber-500/20' },
    { key: 'recording', title: '🎥 LIVE', color: 'text-blue-400', border: 'border-blue-500/20' },
    { key: 'editing', title: '✂️ EDIT', color: 'text-purple-400', border: 'border-purple-500/20' },
    { key: 'done', title: '✅ DONE', color: 'text-emerald-400', border: 'border-emerald-500/20' }
  ];

  return (
    <div className="flex flex-col gap-3 h-full min-h-[380px]">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
        {columns.map(col => {
          const colRequests = requests.filter(r => r.status === col.key);
          return (
            <div key={col.key} className={`bg-zinc-950/40 rounded-2xl p-3 border ${col.border} flex flex-col gap-2 min-h-[220px]`}>
              <div className="flex justify-between items-center border-b border-zinc-900 pb-1">
                <span className={`text-[9px] font-mono font-bold tracking-widest ${col.color}`}>{col.title}</span>
                <span className="bg-zinc-900 text-zinc-400 border border-zinc-800 px-1.5 py-0.5 rounded text-[9px] font-mono">{colRequests.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[260px]">
                {colRequests.length === 0 ? <p className="text-[9px] text-zinc-600 italic text-center py-6">Empty.</p> : (
                  colRequests.map(req => (
                    <div key={req.id} className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-lg flex flex-col gap-1.5 shadow">
                      <div>
                        <p className="text-[11px] font-bold text-zinc-200 line-clamp-1">{req.product}</p>
                        <p className="text-[9px] text-zinc-500 mt-0.5 font-mono">Client: {req.username}</p>
                      </div>
                      {col.key !== 'done' && (
                        <button onClick={() => moveStatus(req.id, req.status)} className="w-full bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 text-zinc-300 font-bold py-1 px-2 rounded text-[9px] flex items-center justify-center gap-0.5 cursor-pointer">
                          Shift Stage <ChevronRight size={10} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CrmBento({ onAddActivity }: { onAddActivity: (msg: string) => void }) {
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const toggleBlacklist = (id: string) => {
    setMembers(prev => prev.map(m => {
      if (m.id === id) {
        const state = !m.isBlacklisted;
        onAddActivity(`🚨 Access sever: ${m.username} blacklisted is ${state}`);
        return { ...m, isBlacklisted: state };
      }
      return m;
    }));
  };

  const saveNote = (id: string, noteText: string) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, note: noteText } : m));
    onAddActivity(`📝 Notes saved for member node.`);
  };

  const filtered = members.filter(m => m.username.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col gap-3 h-full min-h-[400px]">
      <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-900 px-3 py-1.5 rounded-xl">
        <Search size={12} className="text-zinc-500" />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search users..." className="bg-transparent border-none outline-none text-xs text-zinc-300 w-full" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map(m => (
          <div key={m.id} className={`bg-zinc-900 border rounded-2xl p-4 flex flex-col justify-between ${m.isBlacklisted ? 'border-red-500/20 bg-red-950/5' : 'border-zinc-800'}`}>
            <div className="flex gap-3 items-center mb-2">
              <img src={m.avatar} alt="avatar" className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800" />
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-zinc-100 font-mono truncate">{m.username}</h4>
                <p className="text-[9px] text-zinc-500">Yield: €{m.totalSpent}</p>
              </div>
              <button onClick={() => toggleBlacklist(m.id)} className={`py-1 px-2 rounded text-[9px] font-bold border cursor-pointer ${m.isBlacklisted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {m.isBlacklisted ? 'Restore' : 'Sever'}
              </button>
            </div>
            <textarea defaultValue={m.note} onBlur={(e) => saveNote(m.id, e.target.value)} placeholder="Input notes..." className="bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-300 p-1.5 rounded-lg h-10 resize-none outline-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetMatrixBento({ onAddActivity }: { onAddActivity: (msg: string) => void }) {
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");

  const saveProduct = () => {
    if (!prodName || !prodPrice) return;
    const newProd: Product = {
      id: (products.length + 1).toString(),
      name: prodName,
      price: prodPrice,
      stock: "∞",
      link: "https://drive.google.com/demo",
      category: "✨ ITEMS"
    };
    setProducts(prev => [...prev, newProd]);
    onAddActivity(`🛍️ Matrix Injection: Added ${prodName}`);
    setProdName("");
    setProdPrice("");
  };

  const deleteProduct = (id: string, name: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    onAddActivity(`Purged Asset #${id} (${name})`);
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-[400px]">
      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-900 flex gap-2">
        <input type="text" value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="Asset Name" className="flex-2 text-[10px]" />
        <input type="text" value={prodPrice} onChange={(e) => setProdPrice(e.target.value)} placeholder="Price (€)" className="flex-1 text-[10px]" />
        <button onClick={saveProduct} className="bg-emerald-500 text-zinc-950 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer">Add</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {products.map(p => (
          <div key={p.id} className="bg-zinc-900/60 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
            <div>
              <h4 className="text-[11px] font-bold text-zinc-200 truncate">{p.name}</h4>
              <p className="text-xs font-bold text-emerald-400 font-mono mt-1">€{p.price}</p>
            </div>
            <button onClick={() => deleteProduct(p.id, p.name)} className="mt-2 text-red-400 hover:underline text-[9px] self-end cursor-pointer">Purge</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsBento({ onAddActivity, maintenanceActive, setMaintenanceActive, onReviewsCountChange }: { onAddActivity: (msg: string) => void, maintenanceActive: boolean, setMaintenanceActive: React.Dispatch<React.SetStateAction<boolean>>, onReviewsCountChange: (count: number) => void }) {
  const [reviews, setReviews] = useState<Review[]>(INITIAL_REVIEWS);
  const [promos, setPromos] = useState<PromoCode[]>(INITIAL_PROMOS);
  const [promoCodeName, setPromoCodeName] = useState("");
  const [promoDiscount, setPromoDiscount] = useState("");

  useEffect(() => {
    onReviewsCountChange(reviews.length);
  }, [reviews.length, onReviewsCountChange]);

  const approveReview = (id: string, username: string) => {
    setReviews(prev => prev.filter(r => r.id !== id));
    onAddActivity(`⭐ Review Approved for ${username}`);
  };

  const createPromo = () => {
    if (!promoCodeName || !promoDiscount) return;
    const newCode: PromoCode = { code: promoCodeName.toUpperCase(), discount: parseInt(promoDiscount), limit: 10, used: 0, createdAt: "Today" };
    setPromos(prev => [newCode, ...prev]);
    onAddActivity(`🎟️ Promo "${newCode.code}" generated`);
    setPromoCodeName("");
    setPromoDiscount("");
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-[400px]">
      <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-900">
        <h3 className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5"><ShieldAlert size={12} /> Pending Reviews ({reviews.length})</h3>
        <div className="flex flex-col gap-2 max-h-[140px] overflow-y-auto">
          {reviews.length === 0 ? <p className="text-zinc-600 text-xs italic">Clear.</p> : reviews.map(r => (
            <div key={r.id} className="flex justify-between items-center text-[10px] bg-zinc-900 p-2 rounded border border-zinc-800">
              <span className="text-zinc-300 font-mono">{r.username} - {r.product}</span>
              <button onClick={() => approveReview(r.id, r.username)} className="text-emerald-400 font-bold hover:underline cursor-pointer">Approve</button>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex justify-between items-center">
          <div>
            <h4 className="text-xs font-bold mb-1">Maintenance Lockout</h4>
            <p className="text-[10px] text-zinc-500">Disables checkouts completely.</p>
          </div>
          <button onClick={() => setMaintenanceActive(!maintenanceActive)} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${maintenanceActive ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300'}`}>
            {maintenanceActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
        <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-900 flex gap-2 items-center">
          <input type="text" value={promoCodeName} onChange={(e) => setPromoCodeName(e.target.value)} placeholder="PROMO_CODE" className="text-[10px]" />
          <input type="number" value={promoDiscount} onChange={(e) => setPromoDiscount(e.target.value)} placeholder="%" className="text-[10px] w-14" />
          <button onClick={createPromo} className="bg-zinc-100 text-zinc-950 text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer">Create</button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'chat' | 'kanban' | 'crm' | 'assets' | 'settings'>('overview');
  const [activities, setActivities] = useState<Activity[]>(INITIAL_ACTIVITIES);
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [activeTicketsCount, setActiveTicketsCount] = useState(2);
  const [pendingReviewsCount, setPendingReviewsCount] = useState(2);

  const [todayRevenue, setTodayRevenue] = useState(45);
  const [totalRevenue, setTotalRevenue] = useState(485);

  const handleAddActivity = (message: string) => {
    const newAct: Activity = {
      type: message.includes('Sale') ? 'sale' : 'system',
      message,
      time: Date.now()
    };
    setActivities(prev => [newAct, ...prev.slice(0, 10)]);
  };

  useEffect(() => {
    document.title = "NEXUS.PRO - Premium Bento Dashboard";
  }, []);

  return (
    <div className="w-full min-h-screen bg-[#09090b] text-zinc-100 p-4 sm:p-6 flex flex-col font-sans select-none overflow-x-hidden antialiased">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center hover:scale-105 transition-transform shadow-[0_0_15px_rgba(16,185,129,0.25)]">
            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">NEXUS.<span className="text-emerald-500">PRO</span></h1>
            <p className="text-[8px] uppercase tracking-wider text-zinc-500 font-mono">Bento Surveillance System v4.8</p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-1 bg-zinc-950 p-1 border border-zinc-900 rounded-xl">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'analytics', label: 'Analytics' },
            { id: 'chat', label: 'Support', badge: activeTicketsCount },
            { id: 'kanban', label: 'Kanban' },
            { id: 'crm', label: 'Surveillance' },
            { id: 'assets', label: 'Assets' },
            { id: 'settings', label: 'Settings', badge: pendingReviewsCount }
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative cursor-pointer ${
                activeTab === tab.id ? 'bg-zinc-900 text-emerald-400 border border-zinc-800' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
              {!!tab.badge && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-[8px] text-white px-1 rounded-full font-bold scale-90">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div className="bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-[10px] text-zinc-400 hidden sm:flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Route: <span className="text-zinc-200 font-mono">REWARBLE_REVOLUT</span>
          </div>
          <img src="https://api.dicebear.com/7.x/pixel-art/svg?seed=AdminX" className="w-7 h-7 rounded-lg border border-zinc-800" alt="admin" />
        </div>
      </header>

      {maintenanceActive && (
        <div className="mb-4 p-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg text-xs flex items-center gap-2 font-mono animate-pulse">
          <ShieldAlert size={12} />
          MAINTENANCE PROTOCOL ENGAGED: User checkouts suspended.
        </div>
      )}

      <main className="flex-1 min-h-[400px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full"
          >
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div onClick={() => handleAddActivity(`Recalculated yields.`)} className="col-span-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between cursor-pointer hover:border-emerald-500/30 transition-all">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Conversion Index</p>
                    <h2 className="text-2.5xl font-extrabold tracking-tight">84.2%</h2>
                  </div>
                  <div className="flex items-center gap-1 text-emerald-400 text-xs font-semibold mt-4">
                    <TrendingUp size={12} />
                    <span>+12.4% vs last scan</span>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 row-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between overflow-hidden min-h-[240px]">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-200">Temporal Analysis</h3>
                    <p className="text-[10px] text-zinc-500">Hourly density of redemption routes</p>
                  </div>
                  <div className="flex-1 h-28 my-1">
                    <TemporalChart />
                  </div>
                </div>

                <div className="col-span-1 row-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 border-b border-zinc-800 pb-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    Live Activity Stream
                  </h3>
                  <div className="space-y-2 overflow-y-auto max-h-[220px] flex-1 scrollbar-none">
                    {activities.map((act, index) => (
                      <div key={index} className="p-2 bg-zinc-950 border border-zinc-900 rounded-lg">
                        <p className="text-[8px] text-emerald-400 font-mono mb-0.5 flex items-center gap-0.5">
                          <ActivityIcon size={8} />
                          {new Date(act.time).toLocaleTimeString()}
                        </p>
                        <p className="text-[11px] leading-tight text-zinc-300">{act.message}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div onClick={() => {
                  const extra = prompt("Adjust today's earnings (€):");
                  if (extra && !isNaN(parseFloat(extra))) setTodayRevenue(parseFloat(extra));
                }} className="col-span-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between cursor-pointer hover:border-emerald-500/30 transition-all">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Today's Redemptions</p>
                    <h2 className="text-2.5xl font-extrabold tracking-tight text-emerald-400">€{todayRevenue}</h2>
                  </div>
                  <p className="text-[9px] text-zinc-500">Estimated cycle: Instant</p>
                </div>

                <div onClick={() => {
                  const extra = prompt("Adjust total earnings (€):");
                  if (extra && !isNaN(parseFloat(extra))) setTotalRevenue(parseFloat(extra));
                }} className="col-span-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between cursor-pointer hover:border-emerald-500/30 transition-all">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Cumulative Yield</p>
                    <h2 className="text-2.5xl font-extrabold tracking-tight text-emerald-400">€{totalRevenue}</h2>
                  </div>
                  <p className="text-[9px] text-zinc-500">Gross margin: 100%</p>
                </div>

                <div className="col-span-1 md:col-span-2 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex gap-3 items-start">
                  <div className="p-2 bg-emerald-500/10 rounded-full border border-emerald-500/20 shrink-0">
                    <Shield className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-bold text-emerald-400 text-[10px] uppercase tracking-wider">Executive Directive</h4>
                    <p className="text-zinc-300 text-[11px] leading-relaxed mt-1">
                      Metrics indicate checkout systems are unsevered. Recommend keeping cache buffers at maximum.
                    </p>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between">
                  <ActionTerminal onAddActivity={handleAddActivity} />
                </div>
              </div>
            )}

            {activeTab === 'analytics' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3">Weekly Sales Day Distribution</h3>
                  <div className="h-40"><DowChart /></div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3">Sales by Asset Sector</h3>
                  <div className="h-40"><CategoryRevenueChart /></div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3">Voucher Conversion Funnel</h3>
                  <div className="h-40"><FunnelChart /></div>
                </div>
              </div>
            )}

            {activeTab === 'chat' && (
              <ChatBento onAddActivity={handleAddActivity} activeTicketsCount={activeTicketsCount} setActiveTicketsCount={setActiveTicketsCount} />
            )}

            {activeTab === 'kanban' && (
              <KanbanBento onAddActivity={handleAddActivity} />
            )}

            {activeTab === 'crm' && (
              <CrmBento onAddActivity={handleAddActivity} />
            )}

            {activeTab === 'assets' && (
              <AssetMatrixBento onAddActivity={handleAddActivity} />
            )}

            {activeTab === 'settings' && (
              <SettingsBento onAddActivity={handleAddActivity} maintenanceActive={maintenanceActive} setMaintenanceActive={setMaintenanceActive} onReviewsCountChange={setPendingReviewsCount} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="mt-8 pt-4 border-t border-zinc-900 flex flex-col sm:flex-row justify-between items-center text-[8px] text-zinc-600 uppercase tracking-widest font-mono gap-2 font-bold">
        <span>Last Sync: <span className="text-zinc-500">{new Date().toLocaleTimeString()}</span></span>
        <div className="flex gap-4">
          <span>Status: <span className="text-emerald-500">Nominal</span></span>
          <span>Node: Paris-01</span>
        </div>
      </footer>
    </div>
  );
}
