"use client"

import { useEffect, useState, use } from "react"
import { supabase } from "@/utils/supabase/client"
import { MemberProfile } from "@/components/members/MemberProfile"
import { Loader2 } from "lucide-react"

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const [member, setMember] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<"admin" | "staff">("staff")

  const fetchMember = async () => {
    if (!resolvedParams?.id) {
      setMember(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('members')
      .select(`
        *,
        renewals ( * )
      `)
      .eq('id', resolvedParams.id)
      .single()

    if (error) {
      console.error("Error fetching member (code:", error.code, "):", error.message, error.details)
      setMember(null)
    } else {
      const { data: attendance, error: attendanceError } = await supabase
        .from("attendance")
        .select("id, check_in_date, created_at")
        .eq("member_id", resolvedParams.id)
        .order("check_in_date", { ascending: false })

      if (attendanceError) {
        console.warn("Error fetching member attendance:", attendanceError)
      }

      // Load notification logs separately so schema drift on this table
      // cannot block member profile rendering.
      const { data: logs, error: logsError } = await supabase
        .from('member_notification_logs')
        .select('id, kind, recipient_email, sent_at, status, delivered_at, error_message, provider_message_id')
        .eq('member_id', resolvedParams.id)
        .order('sent_at', { ascending: false })

      if (logsError) {
        console.warn("Error fetching member notification logs:", logsError)
      }

      setMember({
        ...data,
        attendance: attendance ?? [],
        member_notification_logs: logs ?? [],
      })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (authData.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle()
      if (profile && profile.role === "admin") {
        setRole("admin")
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchMember()
  }, [resolvedParams.id])

  if (loading) {
    return (
      <div className="flex bg-bg-base/50 items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin" />
      </div>
    )
  }

  if (!member) {
    return (
      <div className="p-8 text-center bg-bg-base/50">
        <h2 className="text-xl font-bold text-primary mb-2">Member Not Found</h2>
        <p className="text-muted">The member you are looking for does not exist.</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto py-6">
      <MemberProfile member={member} onUpdate={fetchMember} role={role} />
    </div>
  )
}
