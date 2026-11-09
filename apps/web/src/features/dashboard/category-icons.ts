import type { CategoryId } from "@finance-tracker/domain";
import groceries from "./icons/groceries.svg";
import publicTransport from "./icons/public_transport.svg";
import flights from "./icons/flights.svg";
import tobacco from "./icons/tobacco.svg";
import sport from "./icons/sport.svg";
import leisure from "./icons/leisure.svg";
import food from "./icons/food.svg";
import rent from "./icons/rent.svg";
import personalCare from "./icons/personal_care.svg";
import gifts from "./icons/gifts.svg";
import subscriptions from "./icons/subscriptions.svg";
import holidays from "./icons/holidays.svg";
import unexpected from "./icons/unexpected.svg";
import salary from "./icons/salary.svg";
import personalProjects from "./icons/personal_projects.svg";
import cash from "./icons/cash.svg";
import transfer from "./icons/transfer.svg";
import other from "./icons/other.svg";

const categoryIcons: Record<CategoryId, string> = {
  groceries, public_transport: publicTransport, flights, tobacco, sport, leisure, food, rent,
  personal_care: personalCare, gifts, subscriptions, holidays, unexpected, salary, personal_projects: personalProjects,
};

export const cashIcon = cash;
export const transferIcon = transfer;
export const otherIcon = other;

export function categoryIcon(category: string | null): string {
  return category && Object.hasOwn(categoryIcons, category) ? categoryIcons[category as CategoryId] : otherIcon;
}
