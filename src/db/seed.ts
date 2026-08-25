import { hashPassword } from "@/core/auth/password";
import {
  addDaysKey,
  calcSubscriptionEndDate,
  nowStamp,
  pad2,
  todayKey,
} from "@/core/dates";
import type { RoleId } from "@/core/permissions";
import type { Db } from "./engine";

export function shouldSeedDemo(): boolean {
  // Frontend (Vite): only in dev with an explicit flag.
  const meta = import.meta as unknown as { env?: { DEV?: boolean; VITE_SEED_DEMO?: string } };
  if (meta.env?.DEV) return String(meta.env.VITE_SEED_DEMO ?? "") === "1";
  // Local backend (Node): opt-in via environment variable.
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return proc.process?.env?.GYM_SEED_DEMO === "1";
}

type MemberStatus = "active" | "inactive" | "suspended" | "archived";

interface DemoUserSeedDef {
  username: string;
  fullName: string;
  roleId: RoleId;
  password: string;
}

interface MemberSeedDef {
  name: string;
  latin: string;
  gender: "male" | "female";
  phone: string;
  status: MemberStatus;
  registeredDaysAgo: number;
}

interface CardSeedDef {
  memberIndex: number | null;
  status: "available" | "assigned" | "lost" | "blocked";
}

interface SubSeedDef {
  memberIndex: number;
  planIndex: number;
  startOffsetDays: number;
  priceFactor?: number;
}

const DEMO_USERS: readonly DemoUserSeedDef[] = [
  { username: "owner", fullName: "مروان عبد الرحمن", roleId: "owner", password: "Owner@2026" },
  { username: "manager", fullName: "هالة يوسف", roleId: "manager", password: "Manage@2026" },
  { username: "reception", fullName: "كريم فؤاد", roleId: "reception", password: "Recep@2026" },
  { username: "trainer", fullName: "أحمد سليم", roleId: "trainer", password: "Trainer@2026" },
];

const DEMO_PLANS = [
  { name: "شهري", durationDays: 30, price: 300, description: "اشتراك شهر كامل بجميع الأجهزة", color: "#38bdf8" },
  { name: "ربع سنوي", durationDays: 90, price: 800, description: "ثلاثة أشهر بسعر مخفض", color: "#a78bfa" },
  { name: "نصف سنوي", durationDays: 180, price: 1500, description: "ستة أشهر مع متابعة تدريبية", color: "#fbbf24" },
  { name: "سنوي", durationDays: 365, price: 2800, description: "عضوية سنوية كاملة", color: "#34d399" },
];

const MEMBER_SEEDS: readonly MemberSeedDef[] = [
  { name: "أحمد عبد الله", latin: "ahmed.abdullah", gender: "male", phone: "01001234567", status: "active", registeredDaysAgo: 210 },
  { name: "سارة الشريف", latin: "sara.elsherif", gender: "female", phone: "01012345678", status: "active", registeredDaysAgo: 180 },
  { name: "محمد منصور", latin: "mohamed.mansour", gender: "male", phone: "01022345678", status: "active", registeredDaysAgo: 160 },
  { name: "نور الحسيني", latin: "nour.elhusseiny", gender: "female", phone: "01032345678", status: "active", registeredDaysAgo: 140 },
  { name: "عمر فتحي", latin: "omar.fathy", gender: "male", phone: "01042345678", status: "active", registeredDaysAgo: 120 },
  { name: "مريم رمضان", latin: "mariam.ramadan", gender: "female", phone: "01052345678", status: "suspended", registeredDaysAgo: 110 },
  { name: "يوسف الجندي", latin: "youssef.elgendy", gender: "male", phone: "01062345678", status: "active", registeredDaysAgo: 95 },
  { name: "هدى شعبان", latin: "hoda.shaaban", gender: "female", phone: "01072345678", status: "active", registeredDaysAgo: 80 },
  { name: "خالد العمري", latin: "khaled.omar", gender: "male", phone: "01082345678", status: "active", registeredDaysAgo: 60 },
  { name: "ياسمين بركات", latin: "yasmin.barakat", gender: "female", phone: "01092345678", status: "active", registeredDaysAgo: 45 },
  { name: "كريم سلامة", latin: "karim.salama", gender: "male", phone: "01103456789", status: "inactive", registeredDaysAgo: 200 },
  { name: "أسماء ناصر", latin: "asmaa.nasser", gender: "female", phone: "01114567890", status: "archived", registeredDaysAgo: 300 },
];

const CARD_SEEDS: readonly CardSeedDef[] = [
  { memberIndex: 1, status: "assigned" },
  { memberIndex: 0, status: "assigned" },
  { memberIndex: 5, status: "assigned" },
  { memberIndex: 10, status: "assigned" },
  { memberIndex: 2, status: "assigned" },
  { memberIndex: 3, status: "assigned" },
  { memberIndex: 6, status: "lost" },
  { memberIndex: 7, status: "blocked" },
  { memberIndex: null, status: "available" },
  { memberIndex: 4, status: "assigned" },
  { memberIndex: null, status: "available" },
];

const SUB_SEEDS: readonly SubSeedDef[] = [
  { memberIndex: 0, planIndex: 0, startOffsetDays: -36 },
  { memberIndex: 1, planIndex: 0, startOffsetDays: -28 },
  { memberIndex: 2, planIndex: 1, startOffsetDays: 1 },
  { memberIndex: 3, planIndex: 0, startOffsetDays: -10 },
  { memberIndex: 4, planIndex: 2, startOffsetDays: -60 },
  { memberIndex: 4, planIndex: 0, startOffsetDays: -120 },
  { memberIndex: 5, planIndex: 0, startOffsetDays: -15 },
  { memberIndex: 6, planIndex: 1, startOffsetDays: -40 },
  { memberIndex: 7, planIndex: 3, startOffsetDays: -100, priceFactor: 0.9 },
  { memberIndex: 8, planIndex: 0, startOffsetDays: -5 },
  { memberIndex: 9, planIndex: 2, startOffsetDays: -30 },
  { memberIndex: 10, planIndex: 0, startOffsetDays: -50 },
  { memberIndex: 11, planIndex: 0, startOffsetDays: -330 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uid(): string {
  return crypto.randomUUID();
}

function mustGet(map: Map<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing id for ${key}`);
  return value;
}

function formatCode(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

function bumpCounter(db: Db, name: string): number {
  db.run("UPDATE counters SET value = value + 1 WHERE name = ?", [name]);
  return Number(db.scalar("SELECT value FROM counters WHERE name = ?", [name]));
}

export async function seedDemoData(db: Db): Promise<void> {
  const passwordHashes = new Map<string, string>();
  for (const user of DEMO_USERS) {
    passwordHashes.set(user.username, await hashPassword(user.password));
  }

  const rnd = mulberry32(20260824);
  const today = todayKey();
  const stampNow = nowStamp();

  const userIds = new Map<string, string>();
  const planIds: string[] = [];
  const memberIds: string[] = [];
  const cardIdsByMember = new Map<number, string>();

  await db.transaction(() => {
    for (const user of DEMO_USERS) {
      const id = uid();
      userIds.set(user.username, id);
      db.run(
        "INSERT INTO users (id, username, email, password_hash, full_name, role_id, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
        [
          id,
          user.username,
          `${user.username}@gympro.app`,
          passwordHashes.get(user.username) ?? "",
          user.fullName,
          user.roleId,
          stampNow,
          stampNow,
        ],
      );
    }

    for (const plan of DEMO_PLANS) {
      const id = uid();
      planIds.push(id);
      db.run(
        "INSERT INTO membership_plans (id, name, duration_days, price, description, color, is_active, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
        [id, plan.name, plan.durationDays, plan.price, plan.description, plan.color, stampNow, stampNow],
      );
    }

    MEMBER_SEEDS.forEach((member, index) => {
      const id = uid();
      memberIds.push(id);
      const code = formatCode("MEM", bumpCounter(db, "member_code"));
      const registrationDate = addDaysKey(today, -member.registeredDaysAgo);
      const createdAt = `${registrationDate} ${pad2(10 + (index % 8))}:${pad2((index * 7) % 60)}:00`;
      const dobYear = 1988 + ((index * 3) % 18);
      db.run(
        "INSERT INTO members (id, member_code, full_name, phone, email, gender, date_of_birth, address, notes, registration_date, status, created_by, archived_at, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          code,
          member.name,
          member.phone,
          `${member.latin}@example.com`,
          member.gender,
          `${dobYear}-${pad2(1 + (index % 12))}-${pad2(1 + ((index * 3) % 27))}`,
          `القاهرة - حي ${pad2(index + 1)}`,
          index === 5
            ? "تعليق مؤقت لحين تسوية المستحقات"
            : index === 10
              ? "متوقف عن الدوام حالياً"
              : null,
          registrationDate,
          member.status,
          mustGet(userIds, "owner"),
          member.status === "archived" ? `${addDaysKey(today, -30)} 12:00:00` : null,
          createdAt,
          createdAt,
        ],
      );
    });

    CARD_SEEDS.forEach((card, index) => {
      const id = uid();
      const barcode = formatCode("GYM", bumpCounter(db, "card_barcode"));
      const memberId = card.memberIndex == null ? null : memberIds[card.memberIndex];
      const assignedAt =
        memberId == null
          ? null
          : `${addDaysKey(today, -(20 + index))} 12:00:00`;
      db.run(
        "INSERT INTO cards (id, barcode_value, status, member_id, assigned_at, assigned_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, barcode, card.status, memberId, assignedAt, memberId == null ? null : mustGet(userIds, "owner"), stampNow, stampNow],
      );
      if (card.memberIndex != null) {
        cardIdsByMember.set(card.memberIndex, id);
      }
    });

    for (const sub of SUB_SEEDS) {
      const plan = DEMO_PLANS[sub.planIndex];
      const startDate = addDaysKey(today, sub.startOffsetDays);
      const endDate = calcSubscriptionEndDate(startDate, plan.durationDays);
      const price = Math.round(plan.price * (sub.priceFactor ?? 1));
      db.run(
        "INSERT INTO member_subscriptions (id, member_id, plan_id, start_date, end_date, price, status, created_by, created_at, updated_at)\nVALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
        [
          uid(),
          memberIds[sub.memberIndex],
          planIds[sub.planIndex],
          startDate,
          endDate,
          price,
          mustGet(userIds, "owner"),
          stampNow,
          stampNow,
        ],
      );
    }

    const receptionId = mustGet(userIds, "reception");
    const attendanceMembers = new Set([0, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let dayOffset = 30; dayOffset >= 0; dayOffset -= 1) {
      for (const memberIndex of attendanceMembers) {
        const isForcedToday = dayOffset === 0 && (memberIndex === 3 || memberIndex === 4);
        if (!isForcedToday && !chance(rnd, 0.5)) continue;
        const dateStr = addDaysKey(today, -dayOffset);
        const hour = isForcedToday ? (memberIndex === 3 ? 9 : 17) : 8 + Math.floor(rnd() * 14);
        const minute = isForcedToday ? 15 + Math.floor(rnd() * 20) : Math.floor(rnd() * 60);
        const second = Math.floor(rnd() * 60);
        const checkinAt = `${dateStr} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
        if (checkinAt > stampNow) continue;
        db.run(
          "INSERT INTO attendance (id, member_id, card_id, checkin_at, created_by, device_identifier)\nVALUES (?, ?, ?, ?, ?, ?)",
          [
            uid(),
            memberIds[memberIndex],
            cardIdsByMember.get(memberIndex) ?? null,
            checkinAt,
            chance(rnd, 0.7) ? receptionId : mustGet(userIds, "owner"),
            "FRONT-DESK-1",
          ],
        );
      }
    }

    const settingsRows: Array<[string, string]> = [
      ["gym_name", "جيم برو"],
      ["currency_symbol", "ج.م"],
      ["checkin_duplicate_window_seconds", "45"],
      ["demo_seeded", "1"],
    ];
    for (const [key, value] of settingsRows) {
      db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  });
}

function chance(rnd: () => number, probability: number): boolean {
  return rnd() < probability;
}
