export type ProductListItem = {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
  category: string | null;
  defaultUnitPrice: string | null;
  qualityFlag: string;
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
  updateHistory: ProductUpdateHistory[];
};

export type ProductUpdateHistory = {
  historyId: string;
  fieldName: string;
  vendorName: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  sourceType: string;
  sourceId: string;
  updatedAt: string;
  updatedBy: string | null;
};
