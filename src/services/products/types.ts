export type ProductListItem = {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
  category: string | null;
  defaultUnitPrice: string | null;
  lastUpdatedAt: string;
};

export type ProductVendorPrice = {
  vendorPriceId: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
  updatedAt: string;
};

export type ProductDetail = ProductListItem & {
  vendorPrices: ProductVendorPrice[];
};
