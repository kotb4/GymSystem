import { Link } from "react-router-dom";
import { CreditCard, Scale, Ticket, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/utils/cn";

export interface MembersHubHeaderProps {
  currentSection: "members" | "subscriptions" | "debts" | "cards";
}

export function MembersHubHeader({ currentSection }: MembersHubHeaderProps) {
  const { hasPermission } = useAuth();

  const canMembers = hasPermission("members.view");
  const canSubs = hasPermission("subscriptions.view");
  const canDebts = hasPermission("debts.view");
  const canCards = hasPermission("cards.view");

  const navCapsules = [
    ...(canMembers
      ? [
          {
            key: "members",
            path: "/members",
            label: "دليل المشتركين والأعضاء",
            icon: UsersRound,
          },
        ]
      : []),
    ...(canSubs
      ? [
          {
            key: "subscriptions",
            path: "/subscriptions",
            label: "الاشتراكات وباقات الأسعار",
            icon: Ticket,
          },
        ]
      : []),
    ...(canDebts
      ? [
          {
            key: "debts",
            path: "/debts",
            label: "مديونيات ومستحقات الأعضاء",
            icon: Scale,
          },
        ]
      : []),
    ...(canCards
      ? [
          {
            key: "cards",
            path: "/cards",
            label: "البطاقات والكروت الذكية",
            icon: CreditCard,
          },
        ]
      : []),
  ];

  if (navCapsules.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-panel-border/50 bg-panel/60 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
      {navCapsules.map((item) => {
        const isActive = currentSection === item.key;
        const Icon = item.icon;

        return (
          <Link
            key={item.key}
            to={item.path}
            className={cn(
              "group relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200",
              isActive
                ? "bg-neon/15 border border-neon/60 text-white shadow-[0_0_12px_rgba(57,255,20,0.25)]"
                : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
            )}
          >
            <Icon
              className={cn(
                "size-4 transition-transform duration-200 group-hover:scale-110",
                isActive ? "text-neon" : "text-subtle",
              )}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
