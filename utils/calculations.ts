import { currency } from "./formatters";

export const calculateScheduleTotalCost = (hourlyRate: number, durationDays: number): string => {
  const NORMAL_WORKING_HOURS = 8;
  const totalCost = hourlyRate * NORMAL_WORKING_HOURS * durationDays;
  return currency.format(totalCost);
}