
export interface OrderItem {
  id: string;
  name: string;
  width: number; // Q.Cách (m)
  length: number; // C.Dài (m)
  quantity: number;
  unit: string;
  priceBuy: number; // Giá bán
  priceImport: number; // Giá nhập
}

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  notes: string;
  date: string;
  orderNo: string;
  shippingCollection: number; // Tiền xe (thu hộ)
  shippingCost: number; // Phí ship (chi phí)
  discountPercent: number;
  items: OrderItem[];
  createdAt: number;
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  afterDiscount: number;
  totalImportCost: number;
  profit: number;
  profitMargin: number;
  grandTotal: number; // Total customer pays
}
