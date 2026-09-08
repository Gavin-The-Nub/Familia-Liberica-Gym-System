import React from "react"
import { StatCard } from "@/components/dashboard/StatCard"
import { Card } from "@/components/ui/Card"
import { createClient } from "@supabase/supabase-js"
import RevenueCharts from "@/components/analytics/RevenueCharts"
import type { ChartPeriodBounds } from "@/utils/date-filters"

function normalizeMembershipType(type?: string | null): "1_day" | "weekly" | "monthly" | "student_monthly" {
  if (!type) return "monthly"
  if (type === "1_day") return "1_day"
  if (type === "weekly" || type === "1_week") return "weekly"
  if (type === "monthly" || type === "1_month") return "monthly"
  if (type === "student_1_month" || type === "student_monthly") return "student_monthly"
  return "monthly"
}

async function getRevenueData(period: ChartPeriodBounds) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { startDate, endDate, prevStart, prevEnd } = period
  const rangeStartMs = new Date(startDate + "T00:00:00").getTime()
  const rangeEndMs = new Date(endDate + "T00:00:00").getTime()
  const renewalAmount = (r: any) => Number(r.payment_amount ?? r.amount ?? 0)
  const renewalDate = (r: any) => r.created_at || r.renewal_date

  // Fetch new member payments (current period)
  const { data: newMembersThis } = await supabase
    .from("members")
    .select("payment_amount, membership_type, created_at")
    .gte("created_at", startDate + "T00:00:00+08:00")
    .lte("created_at", endDate + "T23:59:59+08:00")

  // Fetch renewals (current period) — server-side filtered, not all rows
  const { data: renewalsThis } = await supabase
    .from("renewals")
    .select("payment_amount, membership_type, created_at")
    .gte("created_at", startDate + "T00:00:00+08:00")
    .lte("created_at", endDate + "T23:59:59+08:00")

  // Fetch prev period
  const { data: newMembersPrev } = await supabase
    .from("members")
    .select("payment_amount, created_at")
    .gte("created_at", prevStart + "T00:00:00+08:00")
    .lte("created_at", prevEnd + "T23:59:59+08:00")

  const { data: renewalsPrev } = await supabase
    .from("renewals")
    .select("payment_amount, membership_type, created_at")
    .gte("created_at", prevStart + "T00:00:00+08:00")
    .lte("created_at", prevEnd + "T23:59:59+08:00")

  // Fetch store sales (current period)
  const { data: salesThis } = await supabase
    .from("sales")
    .select("total_price, created_at")
    .gte("created_at", startDate + "T00:00:00+08:00")
    .lte("created_at", endDate + "T23:59:59+08:00")

  // Fetch store sales (prev period)
  const { data: salesPrev } = await supabase
    .from("sales")
    .select("total_price, created_at")
    .gte("created_at", prevStart + "T00:00:00+08:00")
    .lte("created_at", prevEnd + "T23:59:59+08:00")

  // --- Compute summary stats ---
  const newMemberRevenue = (newMembersThis || []).reduce((s, m) => s + Number(m.payment_amount || 0), 0)
  const renewalRevenue   = (renewalsThis   || []).reduce((s, r) => s + renewalAmount(r), 0)
  const membershipRevenue = newMemberRevenue + renewalRevenue
  const storeRevenue = (salesThis || []).reduce((s, sale) => s + Number(sale.total_price || 0), 0)
  
  const totalRevenue = membershipRevenue + storeRevenue

  const prevMembershipRevenue =
    (newMembersPrev || []).reduce((s, m) => s + Number(m.payment_amount || 0), 0) +
    (renewalsPrev   || []).reduce((s, r) => s + renewalAmount(r), 0)
  const prevStoreRevenue = (salesPrev || []).reduce((s, sale) => s + Number(sale.total_price || 0), 0)
  const prevTotalRevenue = prevMembershipRevenue + prevStoreRevenue

  const revDelta = prevTotalRevenue > 0
    ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
    : 0

  const membershipRevDelta = prevMembershipRevenue > 0
    ? ((membershipRevenue - prevMembershipRevenue) / prevMembershipRevenue) * 100
    : 0

  const storeRevDelta = prevStoreRevenue > 0
    ? ((storeRevenue - prevStoreRevenue) / prevStoreRevenue) * 100
    : 0

  const totalMembers =
    (newMembersThis || []).length + (renewalsThis || []).length
  const avgRevPerMember = totalMembers > 0 ? membershipRevenue / totalMembers : 0

  // --- Revenue Over Time (daily buckets across the period) ---
  // Show up to last 14 days of the range for readability; bucket into weeks for longer ranges
  const days = Math.round((rangeEndMs - rangeStartMs) / (1000 * 60 * 60 * 24)) + 1
  const useWeekBuckets = days > 14

  const revenueByDay: Record<string, { newMembers: number; renewals: number; store: number }> = {}

  if (useWeekBuckets) {
    // Week buckets: Week 1, Week 2, …
    for (let i = 0; i < Math.ceil(days / 7); i++) {
      revenueByDay[`Wk ${i + 1}`] = { newMembers: 0, renewals: 0, store: 0 }
    }
    const rangeStart = new Date(startDate + "T00:00:00")
    ;(newMembersThis || []).forEach((m) => {
      const d = new Date(m.created_at)
      const wk = Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7))
      const key = `Wk ${Math.min(wk + 1, Math.ceil(days / 7))}`
      if (revenueByDay[key]) revenueByDay[key].newMembers += Number(m.payment_amount || 0)
    })
    ;(renewalsThis || []).forEach((r) => {
      const d = new Date(renewalDate(r))
      const wk = Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7))
      const key = `Wk ${Math.min(wk + 1, Math.ceil(days / 7))}`
      if (revenueByDay[key]) revenueByDay[key].renewals += renewalAmount(r)
    })
    ;(salesThis || []).forEach((s) => {
      const d = new Date(s.created_at)
      const wk = Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7))
      const key = `Wk ${Math.min(wk + 1, Math.ceil(days / 7))}`
      if (revenueByDay[key]) revenueByDay[key].store += Number(s.total_price || 0)
    })
  } else {
    // Daily: show each day label as "Apr 7"
    const dayMs = 24 * 60 * 60 * 1000
    for (let i = 0; i < days; i++) {
      const d = new Date(rangeStartMs + i * dayMs)
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      revenueByDay[key] = { newMembers: 0, renewals: 0, store: 0 }
    }
    ;(newMembersThis || []).forEach((m) => {
      const key = new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      if (revenueByDay[key]) revenueByDay[key].newMembers += Number(m.payment_amount || 0)
    })
    ;(renewalsThis || []).forEach((r) => {
      const key = new Date(renewalDate(r)).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      if (revenueByDay[key]) revenueByDay[key].renewals += renewalAmount(r)
    })
    ;(salesThis || []).forEach((s) => {
      const key = new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      if (revenueByDay[key]) revenueByDay[key].store += Number(s.total_price || 0)
    })
  }

  const revenueOverTime = Object.entries(revenueByDay).map(([date, vals]) => ({
    date,
    ...vals,
  }))

  // Highest revenue day
  let highestRevDay = { day: "N/A", amount: 0 }
  revenueOverTime.forEach((d) => {
    const total = d.newMembers + d.renewals + d.store
    if (total > highestRevDay.amount) highestRevDay = { day: d.date, amount: total }
  })

  // --- Revenue by Membership Type ---
  const typeColors: Record<string, string> = {
    "1_day": "#9CA3AF",
    "weekly": "#3B82F6",
    "monthly": "#8B5CF6",
    "student_monthly": "#A855F7",
  }
  const typeLabels: Record<string, string> = {
    "1_day": "1 Day",
    "weekly": "Weekly",
    "monthly": "Monthly",
    "student_monthly": "Student Monthly",
  }
  const typeRevMap: Record<string, number> = { "1_day": 0, "weekly": 0, "monthly": 0, "student_monthly": 0 }
  ;(newMembersThis || []).forEach((m) => {
    const normalized = normalizeMembershipType(m.membership_type)
    typeRevMap[normalized] = (typeRevMap[normalized] || 0) + Number(m.payment_amount || 0)
  })
  ;(renewalsThis || []).forEach((r) => {
    const normalized = normalizeMembershipType(r.membership_type)
    typeRevMap[normalized] = (typeRevMap[normalized] || 0) + renewalAmount(r)
  })

  const membershipTypeRev = Object.entries(typeRevMap).map(([type, value]) => ({
    name: typeLabels[type] || type,
    value,
    color: typeColors[type] || "#6B7280",
  }))
  const totalTypeRev = membershipTypeRev.reduce((s, e) => s + e.value, 0)

  // --- Period Comparison (week buckets of the current period vs previous) ---
  const numWeeks = Math.min(Math.ceil(days / 7), 4)
  const weekBuckets = Array.from({ length: numWeeks }, (_, i) => `Wk ${i + 1}`)
  const currentWeeks = new Array(numWeeks).fill(0)
  const previousWeeks = new Array(numWeeks).fill(0)

  const rangeStart = new Date(startDate + "T00:00:00")
  ;(newMembersThis || []).forEach((m) => {
    const d = new Date(m.created_at)
    const wi = Math.min(Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    currentWeeks[wi] += Number(m.payment_amount || 0)
  })
  ;(renewalsThis || []).forEach((r) => {
    const d = new Date(renewalDate(r))
    const wi = Math.min(Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    currentWeeks[wi] += renewalAmount(r)
  })
  ;(salesThis || []).forEach((s) => {
    const d = new Date(s.created_at)
    const wi = Math.min(Math.floor((d.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    currentWeeks[wi] += Number(s.total_price || 0)
  })
  const prevStart2 = new Date(prevStart + "T00:00:00")
  ;(newMembersPrev || []).forEach((m) => {
    const d = new Date(m.created_at)
    const wi = Math.min(Math.floor((d.getTime() - prevStart2.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    previousWeeks[wi] += Number(m.payment_amount || 0)
  })
  ;(renewalsPrev || []).forEach((r) => {
    const d = new Date(renewalDate(r))
    const wi = Math.min(Math.floor((d.getTime() - prevStart2.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    previousWeeks[wi] += renewalAmount(r)
  })
  ;(salesPrev || []).forEach((s) => {
    const d = new Date(s.created_at)
    const wi = Math.min(Math.floor((d.getTime() - prevStart2.getTime()) / (1000 * 60 * 60 * 24 * 7)), numWeeks - 1)
    previousWeeks[wi] += Number(s.total_price || 0)
  })

  const monthlyComparison = weekBuckets.map((week, i) => ({
    week,
    current: currentWeeks[i],
    previous: previousWeeks[i],
  }))

  return {
    totalRevenue,
    membershipRevenue,
    storeRevenue,
    newMemberRevenue,
    renewalRevenue,
    avgRevPerMember,
    revDelta,
    membershipRevDelta,
    storeRevDelta,
    highestRevDay,
    revenueOverTime,
    membershipTypeRev,
    totalTypeRev,
    monthlyComparison,
  }
}

export async function RevenueAnalytics({ period }: { period: ChartPeriodBounds }) {
  const data = await getRevenueData(period)

  return (
    <div className="flex flex-col gap-6">
      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard
          title="Total Revenue"
          value={`₱${data.totalRevenue.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          delta={parseFloat(data.revDelta.toFixed(1))}
          deltaLabel="vs prev period"
        />
        <StatCard
          title="Membership Revenue"
          value={`₱${data.membershipRevenue.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          delta={parseFloat(data.membershipRevDelta.toFixed(1))}
          deltaLabel="vs prev period"
        />
        <StatCard
          title="Store Revenue"
          value={`₱${data.storeRevenue.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          delta={parseFloat(data.storeRevDelta.toFixed(1))}
          deltaLabel="vs prev period"
        />
        <StatCard
          title="Avg Rev / Member"
          value={`₱${data.avgRevPerMember.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        />
        <StatCard
          title="Highest Rev Day"
          value={`₱${data.highestRevDay.amount.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          deltaLabel={data.highestRevDay.day}
        />
      </div>

      <RevenueCharts
        revenueOverTime={data.revenueOverTime}
        membershipTypeRev={data.membershipTypeRev}
        totalTypeRev={data.totalTypeRev}
        monthlyComparison={data.monthlyComparison}
      />
    </div>
  )
}
