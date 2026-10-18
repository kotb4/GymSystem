import { Link } from "react-router-dom";
import { Gift, MessagesSquare, PhoneCall, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/utils/cn";

export interface MarketingHubHeaderProps {
  currentSection: "crm" | "messages" | "loyalty" | "referrals";
}

export function MarketingHubHeader({ currentSection }: MarketingHubHeaderProps) {
  const { hasPermission } = useAuth();

  const canCrm = hasPermission("leads.view") || hasPermission("trials.view");
  const canMessages = hasPermission("messages.view");
  const canLoyalty = hasPermission("loyalty.manage");
  const canReferrals = hasPermission("referrals.view");

  const navCapsules = [
    ...(canCrm
      ? [
          {
            key: "crm",
            path: "/crm",
            label: "العملاء المحتملين والتجارب (CRM)",
            icon: PhoneCall,
          },
        ]
      : []),
    ...(canMessages
      ? [
          {
            key: "messages",
            path: "/messages",
            label: "مركز رسائل الواتساب والتنبيهات",
            icon: MessagesSquare,
          },
        ]
      : []),
    ...(canLoyalty
      ? [
          {
            key: "loyalty",
            path: "/loyalty",
            label: "برنامج نقاط الولاء والمكافآت",
            icon: Gift,
          },
        ]
      : []),
    ...(canReferrals
      ? [
          {
            key: "referrals",
            path: "/referrals",
            label: "نظام إحالات ومشاركات الأعضاء",
            icon: Share2,
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
