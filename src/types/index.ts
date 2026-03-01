// ==========================================
// Shopify Webhook Types
// ==========================================

export interface ShopifyMoneySet {
  shop_money: { amount: string; currency_code: string };
  presentment_money: { amount: string; currency_code: string };
}

export interface ShopifyLineItem {
  id: number;
  name: string;
  title: string;
  quantity: number;
  price: string;
  price_set?: ShopifyMoneySet;
  sku?: string;
  current_quantity?: number;
  total_discount?: string;
  total_discount_set?: ShopifyMoneySet;
  product_id?: number | null;
  variant_id?: number | null;
  variant_title?: string | null;
  grams?: number;
  fulfillment_status?: string | null;
}

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  address1?: string;
  address2?: string | null;
  city?: string;
  province?: string;
  province_code?: string;
  country?: string;
  country_code?: string;
  zip?: string;
  company?: string | null;
}

export interface ShopifyCustomer {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  currency?: string;
  default_address?: ShopifyAddress;
}

export interface ShopifyShippingLine {
  id: number;
  title: string;
  price: string;
  price_set?: ShopifyMoneySet;
  code?: string | null;
  source?: string;
}

// Payload for: orders/create, orders/paid, orders/fulfilled, orders/partially_fulfilled,
//              orders/cancelled, orders/updated, orders/edited
export interface ShopifyOrderPayload {
  id: number;
  order_number: number;
  name: string;
  email: string;
  phone?: string | null;
  created_at: string;
  updated_at: string;
  processed_at?: string;
  cancelled_at?: string | null;
  closed_at?: string | null;
  currency: string;
  financial_status: "pending" | "authorized" | "paid" | "partially_paid" | "partially_refunded" | "refunded" | "voided" | string;
  fulfillment_status: "fulfilled" | "partial" | "restocked" | null | string;
  cancel_reason: string | null;
  order_status_url: string;
  total_price: string;
  total_price_set?: ShopifyMoneySet;
  subtotal_price: string;
  subtotal_price_set?: ShopifyMoneySet;
  current_total_price?: string;
  current_subtotal_price?: string;
  total_discounts: string;
  total_discounts_set?: ShopifyMoneySet;
  total_tax: string;
  total_tax_set?: ShopifyMoneySet;
  total_shipping_price_set?: ShopifyMoneySet;
  total_line_items_price?: string;
  total_outstanding?: string;
  total_weight?: number;
  customer: ShopifyCustomer;
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  shipping_lines?: ShopifyShippingLine[];
  fulfillments?: ShopifyFulfillment[];
  refunds?: ShopifyRefundEntry[];
  tags?: string;
  note?: string | null;
  confirmed?: boolean;
  test?: boolean;
}

// Embedded fulfillment object within orders payload
export interface ShopifyFulfillment {
  id: number;
  order_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[];
  tracking_url?: string | null;
  tracking_urls?: string[];
  shipment_status?: string | null;
  line_items: ShopifyLineItem[];
}

// Embedded refund entry within orders payload
export interface ShopifyRefundEntry {
  id: number;
  order_id?: number;
  created_at: string;
  note?: string | null;
  refund_line_items?: Array<{
    id: number;
    line_item_id: number;
    line_item: ShopifyLineItem;
    quantity: number;
    subtotal: string;
    subtotal_set?: ShopifyMoneySet;
    total_tax?: string;
  }>;
  transactions?: Array<{
    id: number;
    amount: string;
    currency: string;
    kind: string;
    status: string;
  }>;
}

// Payload for: fulfillments/create, fulfillments/update
export interface ShopifyFulfillmentPayload {
  id: number;
  order_id: number;
  status: "pending" | "open" | "success" | "cancelled" | "error" | "failure" | string;
  created_at: string;
  updated_at: string;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[];
  tracking_url?: string | null;
  tracking_urls?: string[];
  shipment_status?: "label_printed" | "label_purchased" | "attempted_delivery" | "ready_for_pickup" | "confirmed" | "in_transit" | "out_for_delivery" | "delivered" | "failure" | string | null;
  destination?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  name?: string;
  receipt?: Record<string, unknown>;
  // The order is NOT included in the fulfillment webhook — only order_id
}

// Payload for: refunds/create
export interface ShopifyRefundPayload {
  id: number;
  order_id: number;
  created_at: string;
  note: string;
  restock?: boolean;
  refund_line_items: Array<{
    id?: number;
    line_item_id?: number;
    line_item: ShopifyLineItem;
    quantity: number;
    subtotal: string;
    subtotal_set?: ShopifyMoneySet;
    total_tax?: string;
  }>;
  transactions?: Array<{
    id: number;
    amount: string;
    currency: string;
    kind: string;
    status: string;
  }>;
}

// ==========================================
// Template Engine Types
// ==========================================

/**
 * NOTE: OrderNotificationType and OrderNotificationData have been removed.
 * 
 * The system now uses a template-driven approach:
 *   - Event types are defined in src/config/templates.json (not in code)
 *   - Messages are built directly from raw Shopify payloads using {{dot.path}} templates
 *   - No intermediate data transformation needed
 * 
 * The Shopify payload types above are kept for documentation and optional type-safety.
 * The template engine itself is fully structure-agnostic.
 */

export interface TemplateEntry {
  enabled: boolean;
  template: string;
}

export type TemplateConfig = Record<string, TemplateEntry>;
