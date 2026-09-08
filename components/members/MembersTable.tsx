"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/utils/supabase/client"
import { Card } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Search, Filter, Plus, User, AlertCircle, MoreVertical } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { RenewModal } from "./RenewModal"
import {
  isSubscriptionCountedActive,
  memberSubscriptionCategory,
  memberStatusBadgeVariant,
  memberStatusLabel,
  getAdjustedEndDate,
} from "@/lib/memberSubscription"

type MemberRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  membership_category: "gym" | "boxing_muaythai"
  // photo_url is NOT fetched in the list view (would bloat egress with base64 data)
  // It is only fetched on the individual member profile page
  membership_type: "1_day" | "weekly" | "monthly"
  status: "active" | "suspended" | "cancelled"
  start_date: string
  end_date: string
  created_at: string
  payment_amount: number
  paid: number
  total_paid: number
  pending_deletion: boolean
}

type MembersTab = "all" | "active" | "expiring_soon" | "expired" | "pending_deletion"
type MembershipTypeFilter = "all" | MemberRow["membership_type"]
type MembershipStatusFilter = "all" | "active" | "expiring_soon" | "expired"

export function MembersTable() {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [tab, setTab] = useState<MembersTab>("all")
  const [showFilters, setShowFilters] = useState(false)
  const [membershipTypeFilter, setMembershipTypeFilter] = useState<MembershipTypeFilter>("all")
  const [membershipStatusFilter, setMembershipStatusFilter] = useState<MembershipStatusFilter>("all")
  const [renewMember, setRenewMember] = useState<MemberRow | null>(null)
  const [isRenewOpen, setIsRenewOpen] = useState(false)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    // Query members and manually calculate the lifetime stats
    // since Supabase JS doesn't support complex aggregate joins well without a view.
    // For MVP, we'll fetch members and a lightweight version of stats.
    const { data, error } = await supabase
      .from("members")
      .select(
        // photo_url intentionally excluded — base64 photos bloat every fetch by MBs.
        // Photos are only loaded on the individual member profile page.
        `id, name, email, phone, membership_category, membership_type, status, start_date, end_date, created_at, payment_amount, pending_deletion,
          renewals ( payment_amount, created_at )`
      )
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching members:", error)
      setLoading(false)
      return
    }

    // Map and aggregate
    const formattedData: MemberRow[] = (data ?? []).map((m: any) => {
      const basePayment = Number(m.payment_amount) || 0
      const renewals = Array.isArray(m.renewals) ? m.renewals : []
      const renewalsByNewest = [...renewals].sort((a: any, b: any) => {
        const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0
        const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0
        return bTime - aTime
      })
      const totalRenewals = renewals.reduce(
        (sum: number, r: any) => sum + (Number(r.payment_amount) || 0),
        0
      )
      const latestRenewal = renewalsByNewest[0] ?? null
      const paid = latestRenewal ? (Number(latestRenewal.payment_amount) || 0) : basePayment

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        membership_category: m.membership_category || "gym",
        photo_url: m.photo_url,
        membership_type: m.membership_type,
        status: m.status,
        start_date: m.start_date,
        end_date: m.end_date,
        created_at: m.created_at,
        payment_amount: basePayment,
        paid,
        total_paid: basePayment + totalRenewals,
        pending_deletion: !!m.pending_deletion,
      }
    })

    setMembers(formattedData)
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const searchFiltered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.email && m.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (m.phone && m.phone.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const tabCounts = {
    all: members.length,
    active: members.filter((m) => isSubscriptionCountedActive(m)).length,
    expiring_soon: members.filter((m) => memberSubscriptionCategory(m) === "expiring_soon").length,
    expired: members.filter((m) => memberSubscriptionCategory(m) === "expired").length,
    pending_deletion: members.filter((m) => m.pending_deletion).length,
  }

  const filteredMembers = searchFiltered.filter((m) => {
    const matchesTab =
      tab === "all"
        ? true
        : tab === "pending_deletion"
          ? m.pending_deletion
          : tab === "active"
            ? isSubscriptionCountedActive(m)
            : memberSubscriptionCategory(m) === tab
    const matchesMembershipType = membershipTypeFilter === "all" ? true : m.membership_type === membershipTypeFilter
    const matchesStatus =
      membershipStatusFilter === "all"
        ? true
        : membershipStatusFilter === "active"
          ? isSubscriptionCountedActive(m)
          : memberSubscriptionCategory(m) === membershipStatusFilter
    return matchesTab && matchesMembershipType && matchesStatus
  })

  const subscriptionSortPriority: Record<string, number> = {
    active: 0,
    expiring_soon: 1,
    expired: 2,
    other: 3,
  }

  const sortedMembers = [...filteredMembers].sort((a, b) => {
    const aPriority = subscriptionSortPriority[memberSubscriptionCategory(a)] ?? 99
    const bPriority = subscriptionSortPriority[memberSubscriptionCategory(b)] ?? 99

    if (aPriority !== bPriority) return aPriority - bPriority
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const tabs: { id: MembersTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "expiring_soon", label: "Expiring soon" },
    { id: "expired", label: "Expired" },
    { id: "pending_deletion", label: "Pending Deletion" },
  ]

  const formatMembershipType = (type: string) => {
    switch(type) {
      case '1_day': return '1 Day'
      case 'weekly': return 'Weekly'
      case 'monthly': return 'Monthly'
      default: return type
    }
  }

  const formatCategory = (cat: string) => {
    switch(cat) {
      case 'gym': return 'Gym'
      case 'boxing_muaythai': return 'Boxing/Muay Thai'
      default: return cat
    }
  }

  return (
    <>
      <Card className="flex flex-col h-full overflow-hidden p-0 border border-white/10">
      <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <Input 
            placeholder="Search members..." 
            className="pl-9 h-10 w-full"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setShowFilters((prev) => !prev)}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>
          <Link href="/members/add" className="flex-1 sm:flex-none">
            <Button className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Member
            </Button>
          </Link>
        </div>
      </div>

      {showFilters && (
        <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] uppercase tracking-wider text-muted">Membership Type</label>
              <select
                value={membershipTypeFilter}
                onChange={(e) => setMembershipTypeFilter(e.target.value as MembershipTypeFilter)}
                className="h-9 min-w-[170px] rounded-md border border-white/20 bg-black/20 px-3 text-sm text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/60"
              >
                <option value="all">All types</option>
                <option value="1_day">1 Day</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] uppercase tracking-wider text-muted">Account Status</label>
              <select
                value={membershipStatusFilter}
                onChange={(e) => setMembershipStatusFilter(e.target.value as MembershipStatusFilter)}
                className="h-9 min-w-[170px] rounded-md border border-white/20 bg-black/20 px-3 text-sm text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/60"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="expiring_soon">Expiring soon</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <Button
              variant="secondary"
              className="md:ml-auto"
              onClick={() => {
                setMembershipTypeFilter("all")
                setMembershipStatusFilter("all")
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="px-4 pb-3 border-b border-white/10">
        <div className="flex flex-wrap gap-2 min-w-min">
          {tabs.map((t) => {
            const count = tabCounts[t.id]
            const isSelected = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-all h-9 px-4 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0A84FF]/60 focus-visible:ring-offset-[#0a0a0f]",
                  isSelected
                    ? "bg-[#0A84FF] text-white border-[#0A84FF]/50 shadow-[0_4px_14px_rgba(10,132,255,0.4)] hover:brightness-110"
                    : "bg-white/10 text-white/90 border-white/10 shadow-[0_4px_14px_rgba(0,0,0,0.1)] backdrop-blur-md hover:bg-white/15"
                )}
              >
                {t.label}{" "}
                <span
                  className={cn(
                    "tabular-nums ml-0.5",
                    isSelected ? "text-white/85" : "text-white/55"
                  )}
                >
                  ({count})
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-card/50 text-muted uppercase text-[11px] font-medium tracking-wider border-b border-white/10">
            <tr>
              <th className="px-6 py-4">Member</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">End Date</th>
              <th className="px-6 py-4 text-right">Paid</th>
              <th className="px-6 py-4 text-right">Total Paid</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted">Loading members...</td>
              </tr>
            ) : sortedMembers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted">No members found.</td>
              </tr>
            ) : (
              sortedMembers.map((member) => {
                const cat = memberSubscriptionCategory(member)
                const isExpired = cat === "expired"
                const isCancelled = member.status === "cancelled"
                const isExpiring = cat === "expiring_soon"
                const isUrgentNegative = isExpired || isCancelled

                return (
                  <tr 
                    key={member.id} 
                    className={cn(
                      "hover:bg-card-hover transition-colors group",
                      isUrgentNegative && "bg-red-500/[0.03] text-red-100/80",
                      isExpiring && !isUrgentNegative && "bg-[#F97316]/[0.06] text-orange-50/95"
                    )}
                  >
                  <td className="px-6 py-4">
                    <Link href={`/members/${member.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-input flex items-center justify-center overflow-hidden shrink-0">
                        {/* photo_url not fetched in list — shows initials only. Full photo on profile page. */}
                        <span className="text-xs font-bold text-zinc-300">
                          {member.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-primary group-hover:text-accent-primary transition-colors flex items-center gap-2">
                          {member.name}
                          {member.pending_deletion && (
                            <Badge variant="negative" className="py-0 leading-none h-4 uppercase text-[9px] px-1.5">
                              Deletion Requested
                            </Badge>
                          )}
                        </div>
                        {member.email && <div className="text-xs text-muted">{member.email}</div>}
                        {member.phone && <div className="text-xs text-muted">{member.phone}</div>}
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={memberStatusBadgeVariant(member)}>
                      <div className="flex items-center gap-1">
                        {(isExpired || isExpiring) && (
                          <AlertCircle className="w-3 h-3 shrink-0" />
                        )}
                        {memberStatusLabel(member)}
                      </div>
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-secondary">
                    <div className="flex flex-col">
                      <span className="capitalize">{formatCategory(member.membership_category)}</span>
                      <span className="text-[10px] text-muted">{formatMembershipType(member.membership_type)}</span>
                    </div>
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-secondary",
                    isExpired && "text-red-400 font-medium",
                    isExpiring && !isExpired && "text-[#FB923C] font-medium"
                  )}>
                    {format(new Date(getAdjustedEndDate(member.end_date, member.membership_type)), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 text-right text-secondary">₱{member.paid.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right text-secondary">₱{member.total_paid.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-3 py-1.5 h-auto text-[10px] uppercase tracking-wider"
                        onClick={() => {
                          setRenewMember(member)
                          setIsRenewOpen(true)
                        }}
                      >
                        Renew
                      </Button>
                      <Link href={`/members/${member.id}`}>
                        <Button variant="secondary" className="px-3 py-1.5 h-auto text-[10px] uppercase tracking-wider">
                          View
                        </Button>
                      </Link>
                    </div>
                  </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>

    <RenewModal
      isOpen={isRenewOpen}
      onClose={() => {
        setIsRenewOpen(false)
        setRenewMember(null)
      }}
      member={renewMember}
      onUpdate={() => void fetchMembers()}
    />
    </>
  )
}
