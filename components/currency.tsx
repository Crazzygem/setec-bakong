"use client";

import { createContext, useCallback, useContext } from "react";
import { formatMoney, type Currency } from "@/lib/money";

const CurrencyContext = createContext<Currency>("KHR");

/** Carries SHOP_CURRENCY from the server at request time, so changing it needs no rebuild. */
export function CurrencyProvider({ currency, children }: { currency: Currency; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export function useShopCurrency(): Currency {
  return useContext(CurrencyContext);
}

/** Formats minor units; pass a currency for historical lines billed in another one. */
export function useMoney() {
  const shop = useShopCurrency();
  return useCallback((minor: number, currency?: Currency) => formatMoney(minor, currency ?? shop), [shop]);
}
