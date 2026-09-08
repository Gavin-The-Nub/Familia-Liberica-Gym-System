import { StatCard } from "@/components/dashboard/StatCard"
import { MiniChart } from "@/components/dashboard/MiniChart"
import { PeakHoursChart } from "@/components/dashboard/PeakHoursChart"
import { WeeklySalesChart } from "@/components/dashboard/WeeklyCharts"
import { createClient } from "@/utils/supabase/server"
import { subDays, format } from "date-fns"
import { isSubscriptionCountedActive, memberSubscriptionCategory } from "@/lib/memberSubscription"
import { PH_TIME_ZONE, phTodayISO, phDateISOFromDate, parseISODateAtPHMidnight } from "@/lib/phTime"
import { resolveAnalyticsPeriod } from "@/utils/date-filters"

// Revalidate every 60 seconds — avoids hitting Supabase on every single request
// while keeping dashboard data reasonably fresh.
export const revalidate = 60

export default async function Dashboard() {
  const supabase = await createClient()
  const todayInPH = phTodayISO()
  // Use a 35-day window to cover: today + last 7 days chart + current billing period (up to ~31 days)
  // This avoids Supabase's 1000-row default cap cutting off recent records.
  const windowStart = phDateISOFromDate(new Date(parseISODateAtPHMidnight(todayInPH).getTime() - 35 * 24 * 60 * 60 * 1000))

  // Only select the columns the dashboard actually needs — never fetch photo_url
  const { data: membersResponse } = await supabase
    .from('members')
    .select('id, name, membership_type, status, end_date, created_at, payment_amount, member_id:id')
  const { data: renewalsResponse } = await supabase
    .from('renewals')
    .select('member_id, membership_type, payment_amount, created_at')
    .gte('created_at', windowStart + 'T00:00:00+08:00')
    .order('created_at', { ascending: false })
  // Only fetch sales within the relevant window (not all 858+ rows)
  const { data: salesResponse } = await supabase
    .from('sales')
    .select('total_price, created_at')
    .gte('created_at', windowStart + 'T00:00:00+08:00')
  const { data: attendanceResponse } = await supabase
    .from("attendance")
    .select("check_in_date, created_at")
    .eq("check_in_date", todayInPH)

  console.log("DASHBOARD SERVER DEBUG:", {
    todayInPH,
    renewalCount: renewalsResponse?.length ?? 0,
    attendanceCount: attendanceResponse?.length ?? 0
  })

  const members = membersResponse || []
  const renewals = renewalsResponse || []
  const sales = salesResponse || []
  const attendance = attendanceResponse || []
  const renewalDate = (r: any) => r.created_at || r.renewal_date
  const renewalAmount = (r: any) => Number(r.payment_amount ?? r.amount ?? 0)

  const todayPH = parseISODateAtPHMidnight(todayInPH)
  const resolved = resolveAnalyticsPeriod({})
  const { startDate, endDate, prevStart, prevEnd } = resolved.chart
  
  // Keep status logic aligned with Members page (considers end_date + raw status)
  const activeMembers = members.filter((m) => isSubscriptionCountedActive(m))
  const totalActiveMembers = activeMembers.length

  // Today's New Members
  const todaysNewMembers = members.filter(m => m.created_at && phDateISOFromDate(new Date(m.created_at)) === todayInPH)
  
  // Today's Revenue
  const todaysMemberSales = members
    .filter(m => m.created_at && phDateISOFromDate(new Date(m.created_at)) === todayInPH)
    .reduce((sum, m) => sum + (m.payment_amount || 0), 0)
  const todaysRenewalSales = renewals
    .filter(r => {
      const d = renewalDate(r)
      return d && phDateISOFromDate(new Date(d)) === todayInPH
    })
    .reduce((sum, r) => sum + renewalAmount(r), 0)
  const todaysStoreSales = sales
    .filter(s => s.created_at && phDateISOFromDate(new Date(s.created_at)) === todayInPH)
    .reduce((sum, s) => sum + Number(s.total_price || 0), 0)
  const todaysRevenue = todaysMemberSales + todaysRenewalSales + todaysStoreSales
  
  // Period Revenue (1-15 or 16-end)
  const monthlyMemberSales = members
    .filter(m => m.created_at && m.created_at >= startDate + "T00:00:00" && m.created_at <= endDate + "T23:59:59")
    .reduce((sum, m) => sum + (m.payment_amount || 0), 0)
  
  const monthlyRenewalSales = renewals
    .filter(r => {
      const d = renewalDate(r)
      return d && d >= startDate + "T00:00:00" && d <= endDate + "T23:59:59"
    })
    .reduce((sum, r) => sum + renewalAmount(r), 0)

  const monthlyStoreSales = sales
    .filter(s => s.created_at && s.created_at >= startDate + "T00:00:00" && s.created_at <= endDate + "T23:59:59")
    .reduce((sum, s) => sum + Number(s.total_price || 0), 0)
  
  const monthlyMembershipRevenue = monthlyMemberSales + monthlyRenewalSales
  const monthlyTotalRevenue = monthlyMembershipRevenue + monthlyStoreSales

  // Previous Period Revenue (for Delta)
  const prevMemberSales = members
    .filter(m => m.created_at && m.created_at >= prevStart + "T00:00:00" && m.created_at <= prevEnd + "T23:59:59")
    .reduce((sum, m) => sum + (m.payment_amount || 0), 0)
  
  const prevRenewalSales = renewals
    .filter(r => {
      const d = renewalDate(r)
      return d && d >= prevStart + "T00:00:00" && d <= prevEnd + "T23:59:59"
    })
    .reduce((sum, r) => sum + renewalAmount(r), 0)

  const prevStoreSales = sales
    .filter(s => s.created_at && s.created_at >= prevStart + "T00:00:00" && s.created_at <= prevEnd + "T23:59:59")
    .reduce((sum, s) => sum + Number(s.total_price || 0), 0)
  
  const prevMembershipRevenue = prevMemberSales + prevRenewalSales
  const prevTotalRevenue = prevMembershipRevenue + prevStoreSales

  const revenueDelta = prevTotalRevenue > 0 
    ? Math.round(((monthlyTotalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100) 
    : 0
  const membershipRevenueDelta = prevMembershipRevenue > 0
    ? Math.round(((monthlyMembershipRevenue - prevMembershipRevenue) / prevMembershipRevenue) * 100)
    : 0
  const storeRevenueDelta = prevStoreSales > 0
    ? Math.round(((monthlyStoreSales - prevStoreSales) / prevStoreSales) * 100)
    : 0
  
  const expiringSoonCount = members.filter(
    (m) => memberSubscriptionCategory(m) === "expiring_soon"
  ).length

  const isSameISODate = (value: string | null | undefined, isoDate: string) => {
    if (!value) return false
    return value.slice(0, 10) === isoDate
  }

  const todaysCheckIns = attendance.filter((a) =>
    isSameISODate(a.check_in_date, todayInPH)
  ).length

  const todayAttendance = attendance.filter((a) =>
    isSameISODate(a.check_in_date, todayInPH)
  )

  const hourLabels = ["6AM", "9AM", "12PM", "3PM", "6PM", "9PM"]
  const hourBuckets: Record<string, number> = {
    "6AM": 0,
    "9AM": 0,
    "12PM": 0,
    "3PM": 0,
    "6PM": 0,
    "9PM": 0,
  }
  const getHourInPH = (value: string): number | null => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    const hourPart = new Intl.DateTimeFormat("en-US", {
      timeZone: PH_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .find((p) => p.type === "hour")?.value
    if (!hourPart) return null
    const parsed = Number(hourPart)
    return Number.isNaN(parsed) ? null : parsed
  }

  todayAttendance.forEach((record) => {
    if (!record.created_at) return
    const hour = getHourInPH(record.created_at)
    if (hour === null) return
    if (hour >= 6 && hour < 9) hourBuckets["6AM"] += 1
    else if (hour >= 9 && hour < 12) hourBuckets["9AM"] += 1
    else if (hour >= 12 && hour < 15) hourBuckets["12PM"] += 1
    else if (hour >= 15 && hour < 18) hourBuckets["3PM"] += 1
    else if (hour >= 18 && hour < 21) hourBuckets["6PM"] += 1
    else if (hour >= 21) hourBuckets["9PM"] += 1
  })

  const peakHoursData = hourLabels.map((label) => ({
    hour: label,
    value: hourBuckets[label],
  }))
  const peakHourEntry = peakHoursData.reduce(
    (max, current) => (current.value > max.value ? current : max),
    { hour: "N/A", value: 0 }
  )
  const totalCheckInsToday = todayAttendance.length

  // WEEKLY CHARTS DATA PREP
  // Last 7 days including today
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(todayPH, 6 - i)
    return {
      date: d,
      name: format(d, 'EEE MMM d'), // Mon Apr 7, etc.
    }
  })

  const weeklySalesData = last7Days.map(day => {
    const dayISO = phDateISOFromDate(day.date)
    const isDay = (dateString: string) => {
      try {
        return phDateISOFromDate(new Date(dateString)) === dayISO
      } catch {
        return false
      }
    }
    
    let oneDaySales = 0
    let weeklySales = 0
    let monthlySales = 0
    let storeSales = 0

    const processPayment = (type: string, amount: number) => {
      if (type === '1_day') oneDaySales += amount
      else if (type === 'weekly') weeklySales += amount
      else if (type === 'monthly') monthlySales += amount
    }

    // Members created on this day
    members.filter(m => m.created_at && isDay(m.created_at)).forEach(m => {
      processPayment(m.membership_type, m.payment_amount || 0)
    })

    // Renewals on this day
    renewals.filter(r => renewalDate(r) && isDay(renewalDate(r))).forEach(r => {
      const parentMember = members.find(mx => mx.id === r.member_id)
      processPayment(r.membership_type || parentMember?.membership_type || '1_month', renewalAmount(r))
    })

    // Store sales on this day
    sales.filter(s => s.created_at && isDay(s.created_at)).forEach(s => {
      storeSales += Number(s.total_price || 0)
    })

    return {
      name: day.name,
      '1 Day': oneDaySales,
      'Weekly': weeklySales,
      'Monthly': monthlySales,
      'Store': storeSales,
      total: oneDaySales + weeklySales + monthlySales + storeSales
    }
  })

  const salesTotals = weeklySalesData.map(d => d.total)
  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard 
          title="Total Active Members" 
          value={totalActiveMembers.toLocaleString()} 
          delta={0} // Kept for layout, could be calculated against last month
          deltaLabel="vs last month"
          className="md:col-span-2 xl:col-span-2 min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#3B82F6" />}
        />
        <StatCard 
          title="Today's New Members" 
          value={todaysNewMembers.length.toString()} 
          delta={0} 
          className="min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#10B981" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard 
          title="Today's Revenue" 
          value={`₱${todaysRevenue.toLocaleString()}`} 
          className="min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#10B981" />}
        />
        <StatCard 
          title={`${resolved.pageLabel} Total Rev`} 
          value={`₱${monthlyTotalRevenue.toLocaleString()}`} 
          delta={revenueDelta} 
          deltaLabel="vs prev period"
          className="min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#3B82F6" />}
        />
        <StatCard 
          title="Membership Rev" 
          value={`₱${monthlyMembershipRevenue.toLocaleString()}`} 
          delta={membershipRevenueDelta} 
          deltaLabel="vs prev period"
          className="min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#8B5CF6" />}
        />
        <StatCard 
          title="Store Rev" 
          value={`₱${monthlyStoreSales.toLocaleString()}`} 
          delta={storeRevenueDelta} 
          deltaLabel="vs prev period"
          className="min-h-[160px]"
          chart={<MiniChart data={salesTotals.length > 0 ? salesTotals : [0,0,0,0,0,0,0]} color="#F59E0B" />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          title="Today's Check-Ins"
          value={todaysCheckIns.toString()}
          className="min-h-[160px]"
          chart={<MiniChart data={peakHoursData.map((item) => item.value)} color="#10B981" />}
        />
        <StatCard
          title="Today's Peak Hour"
          value={peakHourEntry.hour === "N/A" ? "N/A" : `${peakHourEntry.hour} (${peakHourEntry.value})`}
          className="min-h-[160px]"
          chart={<MiniChart data={peakHoursData.map((item) => item.value)} color="#F97316" />}
        />
        <StatCard 
          title="Expiring in 3 Days" 
          value={expiringSoonCount.toString()} 
          delta={0} 
          deltaLabel="Needs attention"
          className="min-h-[160px]"
          chart={<MiniChart data={[0,0,0,0,0,0,0]} color="#EF4444" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <PeakHoursChart
          data={peakHoursData}
          totalCheckIns={totalCheckInsToday}
          windowLabel="Today"
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <WeeklySalesChart data={weeklySalesData} />
      </div>
    </div>
  )
}
