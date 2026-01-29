
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Order, OrderItem } from './types';
import { 
  formatVND, 
  calculateTotals, 
  generateZaloText, 
  exportToCSV,
  isPaper,
  calculateItemArea,
  calculateItemTotal
} from './utils';

const EMPTY_ITEM: OrderItem = {
  id: '',
  name: '',
  width: 0,
  length: 0,
  quantity: 1,
  unit: 'Cái',
  priceBuy: 0,
  priceImport: 0
};

const EMPTY_ORDER: Order = {
  id: '',
  customerName: '',
  phone: '',
  address: '',
  notes: '',
  date: new Date().toISOString().split('T')[0],
  orderNo: '',
  shippingCollection: 0,
  shippingCost: 0,
  discountPercent: 0,
  items: [{ ...EMPTY_ITEM, id: Math.random().toString(36).substr(2, 9) }],
  createdAt: Date.now()
};

// Utility for hashing PIN
const hashPin = async (pin: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(pin + "bacdepzai_salt_2025");
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const App: React.FC = () => {
  const [currentOrder, setCurrentOrder] = useState<Order>({ ...EMPTY_ORDER });
  const [history, setHistory] = useState<Order[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'form' | 'history' | 'stats'>('form');
  const [showPrintModal, setShowPrintModal] = useState(false);
  // Tìm hàm lưu đơn của bạn (ví dụ đặt tên là handleSaveOrder)
const handleSaveOrder = async (orderData: Order) => {
  // 1. Giữ nguyên code lưu localStorage hiện tại của bạn
  // ... code cũ ...

  // 2. Thêm code gửi lên Google Sheets bên dưới
  const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbzpqNsp2lBtp4ZvT4qh8itl43yRoy4pa58DlHME4fIZDoi8lvT_IeTV-aqPhTy3QbM/exec";
  
  try {
    await fetch(GOOGLE_SHEET_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(orderData) // Gửi toàn bộ đối tượng order
    });
    console.log("Đã đồng bộ lên Google Sheets");
  } catch (error) {
    console.error("Lỗi đồng bộ:", error);
  }
};

  // AI Assistant State
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiMessages, setAiMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Role Management State
  const [role, setRole] = useState<'SALE' | 'OWNER'>('SALE');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [storedPinHash, setStoredPinHash] = useState<string | null>(localStorage.getItem('owner_pin_hash'));
  const [showCostOnScreen, setShowCostOnScreen] = useState(localStorage.getItem('owner_show_cost') !== 'false');

  useEffect(() => {
    const saved = localStorage.getItem('bacdepzai_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
    const savedRole = sessionStorage.getItem('current_role');
    if (savedRole === 'OWNER') setRole('OWNER');
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // Validation Logic
  const validation = useMemo(() => {
    const items = currentOrder.items.map(item => {
      const isItemPaper = isPaper(item.name);
      const paperError = isItemPaper && (item.width <= 0 || item.length <= 0);
      const priceWarning = item.priceBuy < item.priceImport && item.priceBuy > 0;
      const zeroTotal = calculateItemTotal(item) <= 0;
      return { id: item.id, paperError, priceWarning, zeroTotal };
    });
    const hasBlockingError = items.some(i => i.paperError || i.zeroTotal);
    const hasPriceWarning = items.some(i => i.priceWarning);
    return { items, hasBlockingError, hasPriceWarning };
  }, [currentOrder.items]);

  // Statistics Calculation
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyOrders = history.filter(o => o.date.startsWith(currentMonthStr));
    let monthlyRevenue = 0;
    let monthlyProfit = 0;
    const customerMap: Record<string, number> = {};
    monthlyOrders.forEach(o => {
      const t = calculateTotals(o);
      monthlyRevenue += t.grandTotal;
      monthlyProfit += t.profit;
      const name = o.customerName || 'Khách lẻ';
      customerMap[name] = (customerMap[name] || 0) + t.grandTotal;
    });
    const topCustomers = Object.entries(customerMap)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    return { currentMonth: currentMonthStr, revenue: monthlyRevenue, profit: monthlyProfit, count: monthlyOrders.length, topCustomers };
  }, [history]);

  const saveToHistory = useCallback(() => {
    if (role === 'OWNER' && validation.hasPriceWarning) {
      if (!confirm('⚠️ Có sản phẩm bán thấp hơn giá nhập. Bạn vẫn muốn lưu?')) return;
    }
    const newOrder = { ...currentOrder, id: Math.random().toString(36).substr(2, 9), createdAt: Date.now() };
    const newHistory = [newOrder, ...history];
    setHistory(newHistory);
    localStorage.setItem('bacdepzai_history', JSON.stringify(newHistory));
    alert('Đã lưu vào lịch sử thành công!');
  }, [currentOrder, history, validation.hasPriceWarning, role]);

  const updateItem = (index: number, fields: Partial<OrderItem>) => {
    const newItems = [...currentOrder.items];
    const updated = { ...newItems[index], ...fields };
    if (fields.name !== undefined && isPaper(fields.name)) {
        updated.unit = 'Cuộn';
    }
    newItems[index] = updated;
    setCurrentOrder({ ...currentOrder, items: newItems });
  };

  const addItem = () => {
    setCurrentOrder({
      ...currentOrder,
      items: [...currentOrder.items, { ...EMPTY_ITEM, id: Math.random().toString(36).substr(2, 9) }]
    });
  };

  const removeItem = (index: number) => {
    if (currentOrder.items.length <= 1) return;
    const newItems = currentOrder.items.filter((_, i) => i !== index);
    setCurrentOrder({ ...currentOrder, items: newItems });
  };

  const totals = useMemo(() => calculateTotals(currentOrder), [currentOrder]);

  const filteredHistory = useMemo(() => {
    return history.filter(o => 
      o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      o.phone.includes(searchTerm)
    );
  }, [history, searchTerm]);

  const copyToZalo = (order: Order) => {
    const text = generateZaloText(order);
    navigator.clipboard.writeText(text).then(() => {
      alert('Đã copy nội dung báo giá!');
    });
  };

  const deleteHistoryItem = (id: string) => {
    if (role !== 'OWNER') return;
    if (confirm('Bạn có chắc muốn xoá đơn này?')) {
      const newHistory = history.filter(o => o.id !== id);
      setHistory(newHistory);
      localStorage.setItem('bacdepzai_history', JSON.stringify(newHistory));
    }
  };

  const loadOrder = (order: Order) => {
    setCurrentOrder({ ...order });
    setActiveTab('form');
  };

  const duplicateOrder = (order: Order) => {
    const duplicatedOrder: Order = {
      ...order,
      id: '',
      date: new Date().toISOString().split('T')[0],
      orderNo: '',
      items: order.items.map(item => ({
        ...item,
        id: Math.random().toString(36).substr(2, 9)
      })),
      createdAt: Date.now()
    };
    setCurrentOrder(duplicatedOrder);
    setActiveTab('form');
    alert('Đã tạo đơn mới từ đơn cũ (Nhân bản)');
  };

  const handleRoleAuth = async () => {
    if (!storedPinHash) {
      if (pinInput.length < 4) {
        alert('PIN phải từ 4-6 số');
        return;
      }
      const hash = await hashPin(pinInput);
      localStorage.setItem('owner_pin_hash', hash);
      setStoredPinHash(hash);
      setRole('OWNER');
      sessionStorage.setItem('current_role', 'OWNER');
      setShowRoleModal(false);
      setPinInput('');
      alert('Đã thiết lập PIN chủ sở hữu thành công!');
    } else {
      const hash = await hashPin(pinInput);
      if (hash === storedPinHash) {
        setRole('OWNER');
        sessionStorage.setItem('current_role', 'OWNER');
        setShowRoleModal(false);
        setPinInput('');
      } else {
        alert('PIN không chính xác');
      }
    }
  };

  const handleLogout = () => {
    setRole('SALE');
    sessionStorage.removeItem('current_role');
    setShowRoleModal(false);
    if (activeTab === 'stats') setActiveTab('form');
  };

  const resetAppData = () => {
    if (confirm('CẢNH BÁO: Thao tác này sẽ xoá TOÀN BỘ dữ liệu đơn hàng và cài đặt PIN. Bạn có chắc chắn?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleAskAI = async (customPrompt?: string) => {
    const prompt = customPrompt || aiInput;
    if (!prompt.trim() && !customPrompt) return;

    const userMessage = { role: 'user' as const, text: prompt };
    setAiMessages(prev => [...prev, userMessage]);
    setAiInput('');
    setIsAiLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const context = {
        currentOrder: {
          customer: currentOrder.customerName,
          total: totals.grandTotal,
          items: currentOrder.items.map(i => `${i.name} (${i.quantity} ${i.unit})`),
          profit: role === 'OWNER' ? totals.profit : 'hidden'
        },
        stats: role === 'OWNER' ? stats : 'hidden',
        role
      };

      const systemInstruction = `Bạn là trợ lý AI thông minh cho cửa hàng "BACDEPZAI" chuyên vật tư in nhanh.
      - Bạn trả lời bằng tiếng Việt thân thiện, chuyên nghiệp.
      - Bạn biết dữ liệu đơn hàng hiện tại: ${JSON.stringify(context)}.
      - Nếu là nhân viên (SALE), hãy giúp họ soạn tin nhắn chào khách, tư vấn kích thước giấy.
      - Nếu là chủ shop (OWNER), hãy phân tích lợi nhuận, gợi ý giảm giá hoặc tăng năng suất.
      - Hãy trả lời ngắn gọn, súc tích, đi thẳng vào vấn đề.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { systemInstruction }
      });

      const modelMessage = { role: 'model' as const, text: response.text || 'Xin lỗi, tôi gặp sự cố khi xử lý câu hỏi này.' };
      setAiMessages(prev => [...prev, modelMessage]);
    } catch (error) {
      console.error("AI Error:", error);
      setAiMessages(prev => [...prev, { role: 'model', text: 'Đã có lỗi xảy ra khi kết nối với trợ lý AI. Vui lòng kiểm tra kết nối mạng.' }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const hasPaperItems = useMemo(() => currentOrder.items.some(i => isPaper(i.name)), [currentOrder.items]);

  const handlePrint = () => {
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const inputClass = "w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400";
  const labelClass = "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";
  const cardClass = "bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden";

  return (
    <div className="min-h-screen">
      <header className="h-14 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 no-print">
        <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xs">BZ</div>
            <h1 className="font-extrabold text-slate-900 tracking-tight hidden sm:block uppercase">BACDEPZAI</h1>
            
            <button 
              onClick={() => setShowRoleModal(true)}
              className={`ml-2 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter transition-colors ${role === 'OWNER' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 hover:text-slate-600'}`}
            >
              {role === 'OWNER' ? 'Chủ Shop' : 'Nhân Viên'}
            </button>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('form')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${activeTab === 'form' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Lập đơn</button>
            <button onClick={() => setActiveTab('history')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Lịch sử</button>
            {role === 'OWNER' && <button onClick={() => setActiveTab('stats')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${activeTab === 'stats' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Thống kê</button>}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8 no-print pb-24">
        {activeTab === 'form' && (
          <div className="space-y-6">
            <div className={cardClass}>
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className={labelClass}>Khách hàng / Xưởng</label>
                        <input type="text" className={inputClass} value={currentOrder.customerName} onChange={e => setCurrentOrder({...currentOrder, customerName: e.target.value})} placeholder="Tên khách hàng..." />
                    </div>
                    <div>
                        <label className={labelClass}>Số điện thoại</label>
                        <input type="text" className={inputClass} value={currentOrder.phone} onChange={e => setCurrentOrder({...currentOrder, phone: e.target.value})} placeholder="09xxx..." />
                    </div>
                    <div>
                        <label className={labelClass}>Ngày & Số đơn</label>
                        <div className="flex gap-2">
                            <input type="date" className={inputClass} value={currentOrder.date} onChange={e => setCurrentOrder({...currentOrder, date: e.target.value})} />
                            <input type="text" className={`${inputClass} w-20 text-center font-mono`} value={currentOrder.orderNo} onChange={e => setCurrentOrder({...currentOrder, orderNo: e.target.value})} placeholder="No." />
                        </div>
                    </div>
                    <div className="md:col-span-3">
                        <label className={labelClass}>Địa chỉ & Ghi chú giao nhận</label>
                        <textarea rows={1} className={inputClass} value={currentOrder.address} onChange={e => setCurrentOrder({...currentOrder, address: e.target.value})} placeholder="Địa chỉ, Chành xe, ghi chú đơn hàng..." />
                    </div>
                </div>
            </div>

            <div className={cardClass}>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[950px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 w-12 text-center">#</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 min-w-[220px]">Tên Hàng Hóa</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-center w-20">Q.Cách</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-center w-20">C.Dài</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-center w-16">SL</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-center w-20">ĐVT</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-center w-20">m²</th>
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-right w-32">Giá Bán</th>
                      {role === 'OWNER' && showCostOnScreen && <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-right w-28">Giá Nhập</th>}
                      <th className="px-3 py-4 text-[10px] font-black uppercase text-slate-400 text-right w-36">Thành Tiền</th>
                      <th className="px-6 py-4 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {currentOrder.items.map((item, idx) => {
                      const paper = isPaper(item.name);
                      const itemVal = validation.items[idx];
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group align-top">
                          <td className="px-6 py-3.5 text-slate-300 font-mono text-[11px] text-center">{idx + 1}</td>
                          <td className="px-3 py-3.5">
                            <input type="text" className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm font-semibold placeholder:text-slate-300" value={item.name} placeholder="Vật tư..." onChange={e => updateItem(idx, { name: e.target.value })} />
                            {itemVal.zeroTotal && <div className="text-[10px] text-orange-500 font-bold mt-1">⚠️ Thành tiền = 0</div>}
                          </td>
                          <td className="px-3 py-3.5"><input type="number" className={`w-full border rounded px-1 text-center text-sm ${!paper ? 'opacity-20 pointer-events-none' : itemVal.paperError ? 'border-red-500 bg-red-50' : 'border-slate-100'}`} value={item.width || ''} onChange={e => updateItem(idx, { width: parseFloat(e.target.value) || 0 })} /></td>
                          <td className="px-3 py-3.5"><input type="number" className={`w-full border rounded px-1 text-center text-sm ${!paper ? 'opacity-20 pointer-events-none' : itemVal.paperError ? 'border-red-500 bg-red-50' : 'border-slate-100'}`} value={item.length || ''} onChange={e => updateItem(idx, { length: parseFloat(e.target.value) || 0 })} />{itemVal.paperError && paper && <div className="text-[9px] text-red-500 font-bold text-center mt-1 uppercase">Thiếu kích thước</div>}</td>
                          <td className="px-3 py-3.5"><input type="number" className="w-full bg-transparent border-none focus:ring-0 p-0 text-center text-sm font-medium" value={item.quantity || ''} onChange={e => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })} /></td>
                          <td className="px-3 py-3.5 text-center text-[11px] font-bold text-slate-400 uppercase"><input type="text" className="w-full bg-transparent border-none focus:ring-0 p-0 text-center text-[11px] font-bold text-slate-400 uppercase" value={item.unit} onChange={e => updateItem(idx, { unit: e.target.value })} /></td>
                          <td className="px-3 py-3.5 text-center text-slate-400 text-xs font-mono">{paper ? calculateItemArea(item).toFixed(2) : '—'}</td>
                          <td className={`px-3 py-3.5 ${role === 'OWNER' && itemVal.priceWarning ? 'bg-rose-50' : ''}`}><input type="number" className={`w-full bg-transparent border-none focus:ring-0 p-0 text-right text-sm font-bold ${role === 'OWNER' && itemVal.priceWarning ? 'text-rose-600' : 'text-indigo-600'}`} value={item.priceBuy || ''} onChange={e => updateItem(idx, { priceBuy: parseFloat(e.target.value) || 0 })} />{role === 'OWNER' && itemVal.priceWarning && <div className="text-[9px] text-rose-500 font-bold text-right mt-1">⚠️ Lỗ vốn</div>}</td>
                          {role === 'OWNER' && showCostOnScreen && (<td className="px-3 py-3.5"><input type="number" className="w-full bg-transparent border-none focus:ring-0 p-0 text-right text-sm text-slate-400" value={item.priceImport || ''} onChange={e => updateItem(idx, { priceImport: parseFloat(e.target.value) || 0 })} /></td>)}
                          <td className="px-3 py-3.5 text-right text-sm font-extrabold text-slate-900">{formatVND(calculateItemTotal(item))}</td>
                          <td className="px-6 py-3.5 text-center"><button onClick={() => removeItem(idx)} className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex justify-between items-center px-6">
                <button onClick={addItem} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm active:scale-95"><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>Thêm dòng hàng</button>
                <div className="text-right"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-4">Tạm tính:</span><span className="text-xl font-extrabold text-slate-900">{formatVND(totals.subtotal)} <span className="text-xs font-normal text-slate-400 uppercase ml-0.5">vnđ</span></span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className={`${cardClass} p-6 space-y-5`}>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Chi phí & Chiết khấu</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={labelClass}>Chiết khấu (%)</label><input type="number" className={inputClass} value={currentOrder.discountPercent || ''} onChange={e => setCurrentOrder({...currentOrder, discountPercent: parseFloat(e.target.value) || 0})} /></div>
                  <div><label className={labelClass}>Tiền giảm</label><div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm text-slate-400 font-medium">{formatVND(totals.discountAmount)}</div></div>
                  <div><label className={labelClass}>Phí ship (chi phí)</label><input type="number" className={inputClass} value={currentOrder.shippingCost || ''} onChange={e => setCurrentOrder({...currentOrder, shippingCost: parseFloat(e.target.value) || 0})} placeholder="Chi trả ship..." /></div>
                  <div><label className={labelClass}>Tiền xe (thu hộ)</label><input type="number" className={inputClass} value={currentOrder.shippingCollection || ''} onChange={e => setCurrentOrder({...currentOrder, shippingCollection: parseFloat(e.target.value) || 0})} placeholder="Khách trả thêm..." /></div>
                </div>
              </div>

              {role === 'OWNER' && showCostOnScreen ? (
                <div className={`${cardClass} p-6 flex flex-col justify-between`}>
                  <div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>Kết quả kinh doanh</h3><div className="grid grid-cols-2 gap-6"><div className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><span className={labelClass}>Tổng vốn</span><span className="text-lg font-bold text-slate-700">{formatVND(totals.totalImportCost)}</span></div><div className={`p-4 rounded-2xl border ${totals.profit >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}><span className={labelClass}>Lợi nhuận ({totals.profitMargin.toFixed(1)}%)</span><span className={`text-lg font-extrabold ${totals.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatVND(totals.profit)}</span></div></div></div>
                  <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-4 items-center justify-between"><div><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tổng thanh toán:</span><span className="text-3xl font-black text-indigo-600">{formatVND(totals.grandTotal)} <span className="text-sm font-normal text-slate-400">đ</span></span></div><div className="flex gap-2 w-full sm:w-auto"><button onClick={() => {if(confirm('Làm mới toàn bộ form?')) setCurrentOrder({...EMPTY_ORDER, items: [{...EMPTY_ITEM, id: Math.random().toString(36).substr(2, 9)}]});}} className="p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button><button onClick={() => copyToZalo(currentOrder)} disabled={validation.hasBlockingError} className={`flex-1 sm:flex-none px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold transition-all active:scale-95 ${validation.hasBlockingError ? 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-50' : 'text-slate-600 hover:bg-slate-50'}`}>Copy Zalo</button><button onClick={saveToHistory} className="flex-1 sm:flex-none px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all active:scale-95">Lưu Đơn</button><button onClick={() => setShowPrintModal(true)} disabled={validation.hasBlockingError} className={`flex-1 sm:flex-none px-8 py-3 rounded-xl text-sm font-black shadow-lg transition-all active:scale-95 uppercase tracking-wide ${validation.hasBlockingError ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 text-white shadow-indigo-600/20 hover:bg-indigo-700'}`}>In Báo Giá</button></div></div>
                </div>
              ) : (
                <div className={`${cardClass} p-6 flex items-center justify-between bg-indigo-50/50`}><div><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tổng thanh toán khách trả:</span><span className="text-3xl font-black text-indigo-600">{formatVND(totals.grandTotal)} <span className="text-sm font-normal text-slate-400">đ</span></span></div><div className="flex gap-2"><button onClick={() => copyToZalo(currentOrder)} disabled={validation.hasBlockingError} className={`px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold transition-all ${validation.hasBlockingError ? 'bg-slate-50 text-slate-300' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Copy Zalo</button><button onClick={saveToHistory} className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all">Lưu Đơn</button><button onClick={() => setShowPrintModal(true)} disabled={validation.hasBlockingError} className={`px-8 py-3 rounded-xl text-sm font-black shadow-lg transition-all uppercase tracking-wide ${validation.hasBlockingError ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white shadow-indigo-600/20 hover:bg-indigo-700'}`}>In Báo Giá</button></div></div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className={`${cardClass} p-4 flex flex-col md:flex-row gap-4 items-center`}><div className="relative flex-1 w-full"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg><input type="text" placeholder="Tìm khách hàng, số điện thoại..." className={`${inputClass} pl-10 h-11`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div><div className="flex gap-2 w-full md:w-auto">{role === 'OWNER' && (<><button onClick={() => exportToCSV(history)} className="flex-1 md:flex-none px-5 py-2.5 bg-emerald-500 text-white font-bold rounded-xl text-xs hover:bg-emerald-600 transition-all active:scale-95">Xuất Excel (CSV)</button><button onClick={() => {if (confirm('Xoá toàn bộ lịch sử?')) {setHistory([]);localStorage.removeItem('bacdepzai_history');}}} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-400 font-bold rounded-xl text-xs hover:bg-rose-50 hover:text-rose-500 hover:border-rose-100 transition-all active:scale-95">Xoá Hết</button></>)}</div></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{filteredHistory.map(o => {const oTotals = calculateTotals(o); return (<div key={o.id} className={`${cardClass} group hover:border-indigo-200 transition-all duration-300`}><div className="p-6"><div className="flex justify-between items-start mb-4"><div className="flex flex-col"><span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{o.date}</span><span className="text-[10px] text-slate-300 font-mono">#{o.orderNo || 'NO-ID'}</span></div><span className="bg-slate-100 text-slate-600 text-[11px] font-extrabold px-3 py-1 rounded-full">{formatVND(oTotals.grandTotal)}</span></div><h4 className="font-bold text-slate-900 mb-1 truncate">{o.customerName || 'Khách chưa đặt tên'}</h4><p className="text-xs text-slate-500 flex items-center gap-1.5 mb-4 font-medium"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>{o.phone || 'N/A'}</p><div className={`grid ${role === 'OWNER' ? 'grid-cols-5' : 'grid-cols-3'} gap-1.5 pt-4 border-t border-slate-50`}><button onClick={() => loadOrder(o)} className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors flex items-center justify-center" title="Mở chỉnh sửa"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button><button onClick={() => duplicateOrder(o)} className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors flex items-center justify-center" title="Nhân bản đơn"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg></button><button onClick={() => copyToZalo(o)} className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center" title="Copy báo giá"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg></button>{role === 'OWNER' && (<><button onClick={() => { setCurrentOrder(o); setShowPrintModal(true); }} className="p-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center" title="In"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg></button><button onClick={() => deleteHistoryItem(o.id)} className="p-2.5 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 transition-colors flex items-center justify-center" title="Xoá"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></>)}</div><div className="mt-4 flex items-center justify-between text-[11px]"><span className="font-bold text-slate-400">Lãi: <span className="text-emerald-500 font-extrabold">{role === 'OWNER' ? formatVND(oTotals.profit) : '***'}</span></span><span className="font-bold text-slate-300">{role === 'OWNER' ? oTotals.profitMargin.toFixed(1) + '%' : '**%'}</span></div></div></div>);})}</div>
          </div>
        )}

        {activeTab === 'stats' && role === 'OWNER' && (
          <div className="space-y-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight">Thống kê tháng {stats.currentMonth}</h2><span className="text-xs font-medium text-slate-500 italic">Dựa trên lịch sử lưu đơn</span></div><div className="grid grid-cols-1 md:grid-cols-3 gap-6"><div className={`${cardClass} p-6 border-l-4 border-indigo-500`}><span className={labelClass}>Tổng doanh thu</span><span className="text-2xl font-black text-indigo-600 leading-none">{formatVND(stats.revenue)} đ</span><p className="text-[10px] text-slate-400 mt-2 font-medium uppercase">Số tiền khách thanh toán</p></div><div className={`${cardClass} p-6 border-l-4 border-emerald-500`}><span className={labelClass}>Lợi nhuận ròng</span><span className="text-2xl font-black text-emerald-600 leading-none">{formatVND(stats.profit)} đ</span><p className="text-[10px] text-slate-400 mt-2 font-medium uppercase">Sau khi trừ vốn & chi phí</p></div><div className={`${cardClass} p-6 border-l-4 border-slate-900`}><span className={labelClass}>Tổng đơn hàng</span><span className="text-2xl font-black text-slate-900 leading-none">{stats.count} đơn</span><p className="text-[10px] text-slate-400 mt-2 font-medium uppercase">Số đơn lập trong tháng</p></div></div><div className={cardClass}><div className="p-4 border-b border-slate-100 bg-slate-50/50"><h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Top 5 khách hàng theo doanh thu</h3></div><div className="divide-y divide-slate-50">{stats.topCustomers.length > 0 ? stats.topCustomers.map((c, idx) => (<div key={c.name} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-4"><span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">{idx + 1}</span><span className="font-bold text-slate-800">{c.name}</span></div><span className="font-black text-slate-900">{formatVND(c.revenue)} đ</span></div>)) : (<div className="p-10 text-center text-slate-400 italic text-sm">Chưa có dữ liệu tháng này</div>)}</div></div></div>
        )}
      </main>

      {/* AI Assistant Floating UI */}
      <div className="fixed bottom-6 right-6 z-50 no-print">
        {showAIChat ? (
          <div className="bg-white rounded-3xl shadow-2xl w-[350px] sm:w-[400px] h-[500px] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300 border border-slate-200">
            <div className="p-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">✨</div>
                <div>
                  <h3 className="text-sm font-bold">Trợ lý BACDEPZAI</h3>
                  <p className="text-[10px] text-indigo-100">Cung cấp bởi Google Gemini AI</p>
                </div>
              </div>
              <button onClick={() => setShowAIChat(false)} className="hover:bg-white/20 p-1 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50">
              {aiMessages.length === 0 && (
                <div className="text-center py-8 space-y-4">
                  <p className="text-sm text-slate-500 italic">Chào bạn! Tôi có thể giúp gì cho cửa hàng hôm nay?</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button onClick={() => handleAskAI("Phân tích đơn hàng hiện tại giúp tôi")} className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-medium hover:border-indigo-500 hover:text-indigo-600 transition-all">📊 Phân tích đơn này</button>
                    <button onClick={() => handleAskAI("Viết 1 mẫu tin nhắn Zalo gửi báo giá chuyên nghiệp")} className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-medium hover:border-indigo-500 hover:text-indigo-600 transition-all">💬 Soạn tin Zalo</button>
                    {role === 'OWNER' && <button onClick={() => handleAskAI("Làm sao để tăng lợi nhuận cho tháng này?")} className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-medium hover:border-indigo-500 hover:text-indigo-600 transition-all">💰 Tăng lợi nhuận</button>}
                  </div>
                </div>
              )}
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-tl-none whitespace-pre-wrap'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isAiLoading && (
                <div className="flex justify-start">
                  <div className="bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-100 rounded-tl-none flex gap-1">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}></div>
            </div>
            <div className="p-3 border-t border-slate-100 bg-white">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  className={`${inputClass} !bg-slate-50 h-10`} 
                  placeholder="Hỏi trợ lý AI..." 
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskAI()}
                />
                <button onClick={() => handleAskAI()} disabled={isAiLoading} className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-700 active:scale-95 disabled:opacity-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform rotate-90" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAIChat(true)} className="w-14 h-14 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white rounded-2xl shadow-xl shadow-indigo-500/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-all group relative">
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </button>
        )}
      </div>

      {/* Role Management Modal */}
      {showRoleModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden p-8">
            <div className="flex justify-between items-start mb-6"><div><h2 className="text-xl font-black text-slate-900">CHẾ ĐỘ TRUY CẬP</h2><p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Vai trò hiện tại: {role === 'OWNER' ? 'Chủ Shop' : 'Nhân Viên'}</p></div><button onClick={() => setShowRoleModal(false)} className="text-slate-300 hover:text-slate-900"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>
            {role === 'SALE' ? (
              <div className="space-y-4"><p className="text-sm text-slate-600 font-medium">Vui lòng nhập PIN để truy cập các tính năng Quản lý (xem lợi nhuận, thống kê, xoá đơn...)</p><div className="space-y-1.5"><label className={labelClass}>{!storedPinHash ? 'Thiết lập PIN mới (4-6 số)' : 'Nhập PIN Quản lý'}</label><input type="password" maxLength={6} className={`${inputClass} text-center text-2xl tracking-[0.5em] font-black h-14`} value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus /></div><button onClick={handleRoleAuth} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-sm shadow-xl shadow-indigo-600/20 active:scale-95 transition-all">{!storedPinHash ? 'Kích hoạt Chủ Shop' : 'Xác nhận PIN'}</button></div>
            ) : (
              <div className="space-y-6"><div className="p-4 bg-slate-50 rounded-2xl space-y-4"><h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Cài đặt chủ shop</h3><div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-700">Hiển thị giá nhập trên màn hình</span><button onClick={() => {const newVal = !showCostOnScreen; setShowCostOnScreen(newVal); localStorage.setItem('owner_show_cost', newVal.toString());}} className={`w-12 h-6 rounded-full transition-colors relative ${showCostOnScreen ? 'bg-indigo-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${showCostOnScreen ? 'left-7' : 'left-1'}`}></div></button></div><button onClick={() => {const newPin = prompt('Nhập PIN mới (4-6 số):'); if (newPin && newPin.length >= 4) {hashPin(newPin).then(hash => {localStorage.setItem('owner_pin_hash', hash); setStoredPinHash(hash); alert('Đã đổi PIN thành công!'); });}}} className="w-full py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl">Đổi mã PIN</button></div><div className="grid grid-cols-2 gap-3"><button onClick={handleLogout} className="py-3 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase text-xs">Thoát Quản Lý</button><button onClick={resetAppData} className="py-3 bg-rose-50 text-rose-500 rounded-2xl font-black uppercase text-xs border border-rose-100">Xoá dữ liệu ứng dụng</button></div></div>
            )}
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm no-print">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50"><h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Xem trước bản in</h3><div className="flex gap-2"><button onClick={handlePrint} className="px-6 py-2 bg-indigo-600 text-white text-xs font-black rounded-xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" /></svg>In Ngay</button><button onClick={() => setShowPrintModal(false)} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all">Đóng</button></div></div>
                <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-100 custom-scrollbar"><div className="bg-white shadow-sm p-6 md:p-8 max-w-[850px] mx-auto min-h-[1100px] rounded-sm"><BusinessInvoiceLayout order={currentOrder} totals={totals} paperMode={hasPaperItems} /></div></div>
            </div>
        </div>
      )}

      {/* Actual Print Area */}
      <div id="print-area" className="hidden"><BusinessInvoiceLayout order={currentOrder} totals={totals} paperMode={hasPaperItems} /></div>
    </div>
  );
};

// Customer-facing Invoice Layout
const BusinessInvoiceLayout = ({ order, totals, paperMode }: { order: Order, totals: any, paperMode: boolean }) => (
  <div className="bg-white text-black leading-tight text-[11pt] p-2 md:p-0">
    <div className="flex justify-between items-center border-b border-black pb-2 mb-3"><div className="flex items-center gap-2"><div className="w-8 h-8 bg-black rounded flex items-center justify-center text-white font-black text-sm">BZ</div><div><h2 className="text-sm font-bold tracking-tight uppercase leading-none">BACDEPZAI</h2><p className="text-[7pt] text-slate-600 font-medium uppercase tracking-widest mt-0.5">Vật tư in nhanh</p></div></div><div className="text-right"><h1 className="text-[20px] font-bold text-black tracking-tight leading-none uppercase">BÁO GIÁ VẬT TƯ</h1><p className="text-[8pt] font-mono text-slate-500 mt-0.5">Số đơn: {order.orderNo || 'N/A'}</p></div></div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-3 text-[10pt]"><div className="flex items-baseline gap-1.5"><span className="font-bold whitespace-nowrap">Khách hàng:</span><span className="font-bold underline decoration-slate-200 underline-offset-2">{order.customerName || '................................'}</span></div><div className="flex items-baseline gap-1.5"><span className="font-bold whitespace-nowrap">Ngày:</span><span>{order.date}</span></div><div className="flex items-baseline gap-1.5"><span className="font-bold whitespace-nowrap">Số ĐT:</span><span className="font-medium underline decoration-slate-200 underline-offset-2">{order.phone || '................'}</span></div><div className="flex items-baseline gap-1.5"><span className="font-bold whitespace-nowrap">Địa chỉ:</span><span className="text-sm underline decoration-slate-200 underline-offset-2">{order.address || '................'}</span></div></div>
    <table className="w-full border-collapse mb-3 text-[9.5pt]">
      <thead><tr className="border-t border-black border-b-2"><th className="py-1 text-left font-bold uppercase tracking-tight">Mô tả hàng hóa</th>{paperMode ? (<><th className="py-1 px-1 text-right font-bold uppercase tracking-tight">Q.Cách</th><th className="py-1 px-1 text-right font-bold uppercase tracking-tight">C.Dài</th><th className="py-1 px-1 text-right font-bold uppercase tracking-tight">SL</th><th className="py-1 px-1 text-center font-bold uppercase tracking-tight">ĐVT</th><th className="py-1 px-1 text-right font-bold uppercase tracking-tight">Số m²</th></>) : (<><th className="py-1 px-1 text-right font-bold uppercase tracking-tight">Số lượng</th><th className="py-1 px-1 text-right font-bold uppercase tracking-tight opacity-0 w-0 p-0">.</th></>)}<th className="py-1 text-right font-bold uppercase tracking-tight">Đơn giá</th><th className="py-1 text-right font-bold uppercase tracking-tight">Thành tiền</th></tr></thead>
      <tbody className="divide-y divide-slate-300 border-b border-black">{order.items.map((item) => {const paper = isPaper(item.name); return (<tr key={item.id}><td className="py-1 font-bold">{item.name}</td>{paperMode ? (<><td className="py-1 px-1 text-right">{paper ? item.width : '—'}</td><td className="py-1 px-1 text-right">{paper ? item.length : '—'}</td><td className="py-1 px-1 text-right">{item.quantity}</td><td className="py-1 px-1 text-center uppercase text-[8pt]">{item.unit}</td><td className="py-1 px-1 text-right font-semibold">{paper ? calculateItemArea(item).toFixed(2) : '—'}</td></>) : (<><td className="py-1 px-1 text-right">{item.quantity}</td><td className="py-1 px-1 text-right opacity-0 w-0 p-0">.</td></>)}<td className="py-1 text-right">{formatVND(item.priceBuy)}</td><td className="py-1 text-right font-bold text-black">{formatVND(calculateItemTotal(item))}</td></tr>); })}</tbody>
    </table>
    <div className="flex justify-end mb-6"><div className="w-56 space-y-0.5 text-[10pt]"><div className="flex justify-between"><span className="text-slate-600">Tạm tính:</span><span>{formatVND(totals.subtotal)} đ</span></div>{totals.discountAmount > 0 && (<div className="flex justify-between text-slate-500 italic"><span>Chiết khấu ({order.discountPercent}%):</span><span>- {formatVND(totals.discountAmount)} đ</span></div>)}<div className="flex justify-between"><span className="text-slate-600">Phí vận chuyển:</span><span>{formatVND(order.shippingCost)} đ</span></div><div className="flex justify-between"><span className="text-slate-600">Tiền xe (thu hộ):</span><span>{formatVND(order.shippingCollection)} đ</span></div><div className="flex justify-between items-center border-t border-black pt-1 mt-1"><span className="font-bold text-[10pt] uppercase">TỔNG CỘNG:</span><span className="text-[18px] font-black">{formatVND(totals.grandTotal)} đ</span></div></div></div>
    <div className="grid grid-cols-2 text-center text-[10pt]"><div><p className="font-bold uppercase mb-10">Người lập biểu</p><p className="font-bold underline decoration-slate-300 underline-offset-4">BACDEPZAI</p></div><div><p className="font-bold uppercase mb-10">Khách hàng xác nhận</p><p className="italic text-slate-400 font-medium">(Ký và ghi rõ họ tên)</p></div></div>
    {order.notes && (<div className="mt-8 pt-2 border-t border-dotted border-slate-300 text-[8pt] text-slate-600 italic"><p><span className="font-bold uppercase mr-1.5 not-italic">Ghi chú:</span> {order.notes}</p></div>)}
  </div>
);

export default App;
