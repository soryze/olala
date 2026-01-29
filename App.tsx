import React, { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';

// Cấu hình Link Google của bạn ở đây
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbwGtVAdp6iQ4X4-b1N3pZNApXEnGmH1pVXOSxHZZTe0kHAAcWj0WY6s27zesRG8vVQ/exec";

export default function App() {
  const [customerName, setCustomerName] = useState('');
  const [items, setItems] = useState([{ id: Date.now(), name: '', spec: '', qty: 1, price: 0 }]);

  // Tính tổng tiền đơn hàng
  const totalAmount = items.reduce((sum, item) => sum + (item.qty * item.price), 0);

  const addItem = () => {
    setItems([...items, { id: Date.now(), name: '', spec: '', qty: 1, price: 0 }]);
  };

  const removeItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  const updateItem = (id, field, value) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleSave = async () => {
    if (!customerName) return alert("Vui lòng nhập tên khách!");

    const orderData = {
      orderNo: "DH-" + Date.now().toString().slice(-6),
      customerName: customerName,
      items: items.map(i => ({
        name: i.name,
        specification: i.spec,
        quantity: i.qty,
        total: i.qty * i.price
      }))
    };

    try {
      await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(orderData)
      });
      alert("Đã lưu đơn thành công vào Google Sheets!");
      setCustomerName('');
      setItems([{ id: Date.now(), name: '', spec: '', qty: 1, price: 0 }]);
    } catch (error) {
      alert("Lỗi kết nối!");
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4 text-blue-600">HỆ THỐNG TÍNH GIÁ ĐƠN HÀNG</h1>
      
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <label className="block mb-2 font-semibold">Tên khách hàng:</label>
        <input 
          className="w-full p-2 border rounded"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nhập tên khách..."
        />
      </div>

      <table className="w-full mb-4 border-collapse">
        <thead>
          <tr className="bg-blue-500 text-white">
            <th className="p-2 border">Tên hàng</th>
            <th className="p-2 border">Quy cách</th>
            <th className="p-2 border">Số lượng</th>
            <th className="p-2 border">Đơn giá</th>
            <th className="p-2 border">Thành tiền</th>
            <th className="p-2 border">Xóa</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="border p-1"><input className="w-full" onChange={e => updateItem(item.id, 'name', e.target.value)} /></td>
              <td className="border p-1"><input className="w-full" onChange={e => updateItem(item.id, 'spec', e.target.value)} /></td>
              <td className="border p-1"><input type="number" className="w-full" value={item.qty} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))} /></td>
              <td className="border p-1"><input type="number" className="w-full" value={item.price} onChange={e => updateItem(item.id, 'price', Number(e.target.value))} /></td>
              <td className="border p-1 text-right">{(item.qty * item.price).toLocaleString()}đ</td>
              <td className="border p-1 text-center">
                <button onClick={() => removeItem(item.id)} className="text-red-500"><Trash2 size={18} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-between items-center bg-gray-100 p-4 rounded">
        <button onClick={addItem} className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">
          <Plus size={18} /> Thêm hàng
        </button>
        <div className="text-xl font-bold">Tổng cộng: <span className="text-red-600">{totalAmount.toLocaleString()} VNĐ</span></div>
        <button onClick={handleSave} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
          <Save size={18} /> LƯU ĐƠN HÀNG
        </button>
      </div>
    </div>
  );
}
