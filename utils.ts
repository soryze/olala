
import { Order, OrderItem, OrderTotals } from './types';

export const formatVND = (amount: number): string => {
  return new Intl.NumberFormat('vi-VN').format(amount);
};

export const isPaper = (name: string): boolean => {
  return name.toLowerCase().includes('giấy');
};

export const calculateItemArea = (item: OrderItem): number => {
  if (!isPaper(item.name)) return 0;
  return item.width * item.length * item.quantity;
};

export const calculateItemTotal = (item: OrderItem): number => {
  if (isPaper(item.name)) {
    return calculateItemArea(item) * item.priceBuy;
  }
  return item.quantity * item.priceBuy;
};

export const calculateItemImportCost = (item: OrderItem): number => {
  if (isPaper(item.name)) {
    return calculateItemArea(item) * item.priceImport;
  }
  return item.quantity * item.priceImport;
};

export const calculateTotals = (order: Order): OrderTotals => {
  const subtotal = order.items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
  const totalImportCost = order.items.reduce((sum, item) => sum + calculateItemImportCost(item), 0);
  
  const discountAmount = subtotal * (order.discountPercent / 100);
  const afterDiscount = subtotal - discountAmount;
  
  const profit = afterDiscount - (totalImportCost + order.shippingCost);
  const profitMargin = afterDiscount > 0 ? (profit / afterDiscount) * 100 : 0;
  
  const grandTotal = afterDiscount + order.shippingCost + order.shippingCollection;

  return {
    subtotal,
    discountAmount,
    afterDiscount,
    totalImportCost,
    profit,
    profitMargin,
    grandTotal
  };
};

export const generateZaloText = (order: Order): string => {
  const totals = calculateTotals(order);
  const itemsText = order.items.map(item => {
    if (isPaper(item.name)) {
      const area = calculateItemArea(item).toFixed(2);
      return `- ${item.name}: ${area} m² x ${formatVND(item.priceBuy)} = ${formatVND(calculateItemTotal(item))}`;
    }
    return `- ${item.name}: ${item.quantity} ${item.unit} x ${formatVND(item.priceBuy)} = ${formatVND(calculateItemTotal(item))}`;
  }).join('\n');

  return `BÁO GIÁ VẬT TƯ
Ngày: ${order.date}
Đơn số: ${order.orderNo || 'N/A'}
Khách hàng: ${order.customerName}
SĐT: ${order.phone}
Địa chỉ: ${order.address}

DANH SÁCH HÀNG:
${itemsText}

-------------------
Tạm tính: ${formatVND(totals.subtotal)}
Chiết khấu (${order.discountPercent}%): ${formatVND(totals.discountAmount)}
Phí ship: ${formatVND(order.shippingCost)}
Tiền xe (thu hộ): ${formatVND(order.shippingCollection)}
TỔNG THANH TOÁN: ${formatVND(totals.grandTotal)}
`;
};

export const exportToCSV = (history: Order[]) => {
  const headers = ['Ngày', 'Số Đơn', 'Khách Hàng', 'SĐT', 'Tổng Cộng', 'Lợi Nhuận'];
  const rows = history.map(o => {
    const t = calculateTotals(o);
    return [o.date, o.orderNo, o.customerName, o.phone, t.grandTotal, t.profit];
  });
  
  const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `lich_su_bao_gia_${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
