import * as React from "react"
import {
  AlertTriangle,
  Camera,
  Loader2,
  Monitor,
} from "lucide-react"
import { toast } from "sonner"
import { authClient, useSession } from "@/lib/auth-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { PersonalBillingTab } from "@/components/settings/PersonalBillingTab"
import { requestPasswordReset } from "@/server/email-actions"
import { submitBillingRequest } from "@/server/billing-actions"

const useToast = () => ({ toast });

interface UserSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserSettingsModal({ open, onOpenChange }: UserSettingsModalProps) {
  const { data: session } = useSession()
  const user = session?.user

  const initialFirstName = user?.name?.split(' ')[0] || "";
  const initialLastName = user?.name?.split(' ').slice(1).join(' ') || "";

  const [firstName, setFirstName] = React.useState(initialFirstName)
  const [lastName, setLastName] = React.useState(initialLastName)
  const [bio, setBio] = React.useState("")
  const [isSaving, setIsSaving] = React.useState(false)
  const [isRequestingReset, setIsRequestingReset] = React.useState(false)
  const [sessions, setSessions] = React.useState<Array<any>>([])
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  const [newImage, setNewImage] = React.useState<string | null>(null)
  const imageInputRef = React.useRef<HTMLInputElement>(null)
  const [isContactDialogOpen, setIsContactDialogOpen] = React.useState(false)
  const [contactForm, setContactForm] = React.useState({ name: "", email: "", company: "", message: "" })
  const { toast: uiToast } = useToast()

  const isDirty = firstName !== initialFirstName || lastName !== initialLastName || bio !== "";

  React.useEffect(() => {
    if (user?.name) {
      const parts = user.name.split(' ')
      setFirstName(parts[0] || "")
      setLastName(parts.slice(1).join(' ') || "")
    }
  }, [user])

  React.useEffect(() => {
    if (open) {
      authClient.listSessions().then(res => {
        if (res.data) setSessions(res.data)
      })
    }
  }, [open])

  const handleUpdateProfile = async () => {
    setIsSaving(true)
    try {
      await authClient.updateUser({
        name: `${firstName} ${lastName}`.trim(),
        image: newImage || undefined
      })
      toast.success("Profile updated successfully")
      setNewImage(null) // Reset after success
      window.location.reload()
    } catch {
      toast.error("Failed to update profile")
    } finally {
      setIsSaving(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File is too large. Max 5MB.")
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        setNewImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRequestReset = async () => {
    if (!user?.email) return;
    setIsRequestingReset(true);
    try {
      await requestPasswordReset({ data: user.email });
      toast.success("Password reset email sent!");
    } catch {
      toast.error("Failed to send reset email");
    } finally {
      setIsRequestingReset(false);
    }
  };

  const handleRevokeSession = async (token: string) => {
    try {
      await authClient.revokeSession({ token })
      setSessions(prev => prev.filter(s => s.token !== token))
      toast.success("Session revoked")
    } catch {
      toast.error("Failed to revoke session")
    }
  }

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true)
    try {
      const { error } = await authClient.deleteUser()
      if (error) throw error
      toast.success("Account deleted")
      window.location.href = "/login"
    } catch (err: any) {
      console.error("Delete user error:", err)
      toast.error(err.message || "Failed to delete account")
      setIsDeletingAccount(false)
    }
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await submitBillingRequest({ data: contactForm })
      setIsContactDialogOpen(false)
      uiToast.success("Request sent! We'll get back to you shortly.")
      setContactForm({ name: "", email: "", company: "", message: "" })
    } catch {
      uiToast.error("Failed to send request. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[1000px] w-[90vw] p-0 overflow-hidden bg-black border-zinc-900 shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-xl border-white/5 max-h-[90vh] flex flex-col">
          <div className="p-8 pb-0 shrink-0">
            <DialogHeader>
              <div>
                <DialogTitle className="text-3xl font-black text-zinc-100 tracking-tight">
                  Settings
                </DialogTitle>
                <DialogDescription className="text-zinc-500 mt-1">
                  Manage your profile and account preferences
                </DialogDescription>
              </div>
            </DialogHeader>
          </div>

          <Tabs defaultValue="profile" className="w-full flex-1 flex flex-col overflow-hidden">
            <div className="px-8 mt-2 shrink-0">
              <TabsList variant="line" className="bg-transparent h-12 p-0 gap-8 justify-start border-b border-zinc-800/30 w-full rounded-none">
                <TabsTrigger
                  value="profile"
                  className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-[3px] border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-bold text-zinc-600 transition-all hover:text-zinc-300"
                >
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="security"
                  className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-[3px] border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-bold text-zinc-600 transition-all hover:text-zinc-300"
                >
                  Security
                </TabsTrigger>
                <TabsTrigger
                  value="billing"
                  className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-[3px] border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-bold text-zinc-600 transition-all hover:text-zinc-300"
                >
                  Billing
                </TabsTrigger>
                <TabsTrigger
                  value="notifications"
                  className="data-[state=active]:!bg-transparent data-[state=active]:text-white data-[state=active]:!shadow-none border-b-[3px] border-transparent data-[state=active]:border-blue-500 rounded-none h-full px-0 text-sm font-bold text-zinc-600 transition-all hover:text-zinc-300"
                >
                  Notifications
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Fixed height to match Profile tab and prevent jumping when switching tabs */}
            <div className="h-[650px] overflow-y-auto p-8 pt-6 space-y-8 animate-in fade-in-50 duration-500 custom-invisible-scrollbar">
              <style>{`
              .custom-invisible-scrollbar::-webkit-scrollbar {
                width: 0px;
                background: transparent;
              }
              .custom-invisible-scrollbar {
                -ms-overflow-style: none;
                scrollbar-width: none;
              }
            `}</style>

              {/* Profile Tab Content */}
              <TabsContent value="profile" className="m-0 space-y-8 max-w-4xl">
                <Card className="bg-zinc-900/30 border-zinc-800/50 shadow-sm border-white/5 rounded-xl">
                  <CardContent className="pt-6">
                    <Label className="text-sm font-bold text-zinc-100 mb-4 block uppercase tracking-widest text-[11px]">Profile picture</Label>
                    <div className="flex items-center gap-6">
                      <Avatar className="h-20 w-20 border-2 border-zinc-800 shadow-xl overflow-hidden">
                        <AvatarImage src={newImage || user?.image || ""} />
                        <AvatarFallback className="bg-zinc-800 text-zinc-100 text-2xl font-bold">
                          {user?.name?.[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-zinc-400">{user?.email}</p>
                        <input
                          type="file"
                          ref={imageInputRef}
                          className="hidden"
                          accept="image/*"
                          onChange={handleImageUpload}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => imageInputRef.current?.click()}
                          className="h-10 px-6 rounded-xl border-zinc-800 text-xs font-bold mt-2 bg-white/5 hover:bg-white/10 transition-all"
                        >
                          <Camera className="h-3.5 w-3.5 mr-2" /> Upload picture
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900/30 border-zinc-800/50 shadow-sm border-white/5 rounded-xl">
                  <CardContent className="pt-6 space-y-6">
                    <Label className="text-sm font-bold text-zinc-100 block uppercase tracking-widest text-[11px]">Personal information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">First Name</Label>
                        <Input
                          value={firstName}
                          onChange={e => setFirstName(e.target.value)}
                          className="bg-zinc-950/50 border-zinc-800 h-12 rounded-xl border-white/5 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Last Name</Label>
                        <Input
                          value={lastName}
                          onChange={e => setLastName(e.target.value)}
                          className="bg-zinc-950/50 border-zinc-800 h-12 rounded-xl border-white/5 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Email address</Label>
                      <Input value={user?.email} className="bg-zinc-800/50 border-zinc-800 cursor-not-allowed h-12 rounded-xl opacity-50 border-white/5" disabled />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Bio</Label>
                      <textarea
                        value={bio}
                        onChange={e => setBio(e.target.value)}
                        className="flex min-h-[120px] w-full rounded-xl border border-zinc-800 border-white/5 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                        placeholder="Tell us about yourself..."
                      />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <Button
                        onClick={handleUpdateProfile}
                        disabled={isSaving || (!isDirty && !newImage)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 h-12 rounded-xl shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
                      >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Save changes
                      </Button>
                      <Button variant="outline" className="px-8 h-12 rounded-xl font-bold border-zinc-800 bg-white/5 hover:bg-white/10 transition-all" onClick={() => {
                        setFirstName(initialFirstName);
                        setLastName(initialLastName);
                        setBio("");
                      }}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900/30 border-zinc-800/50 shadow-sm border-white/5 rounded-xl mb-8">
                  <CardContent className="pt-6 space-y-6">
                    <Label className="text-sm font-bold text-zinc-100 block uppercase tracking-widest text-[11px]">Preferences</Label>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-zinc-100">Dark mode</p>
                        <p className="text-xs text-zinc-500">Use dark theme across the app</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-red-500/20 bg-red-500/5 rounded-xl border-white/5 mb-8">
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-red-500">Delete Account</p>
                      <p className="text-xs text-zinc-500">Permanently delete your account and all data.</p>
                    </div>
                    <Button
                      variant="destructive"
                      className="font-bold h-11 px-8 rounded-xl"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      Delete
                    </Button>
                  </CardContent>
                </Card>

              </TabsContent>

              {/* Security Tab */}
              <TabsContent value="security" className="m-0 space-y-8 animate-in fade-in duration-300">
                <div className="space-y-8 max-w-4xl">
                  <Card className="bg-zinc-900/30 border-zinc-800/50 shadow-sm border-white/5 rounded-xl">
                    <CardContent className="pt-6 space-y-4">

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-zinc-100">Reset Password</p>
                          <p className="text-xs text-zinc-500">Receive a link to reset your password via email</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRequestReset}
                          disabled={isRequestingReset}
                          className="font-bold border-zinc-800 bg-white/5 hover:bg-white/10 h-10 px-6 rounded-xl transition-all"
                        >
                          {isRequestingReset ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Send Link
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <section className="space-y-4">
                    <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Active Sessions</h3>
                    <div className="space-y-3">
                      {sessions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between p-5 bg-zinc-900/30 border border-zinc-800/50 rounded-xl group transition-all hover:bg-zinc-900/50">
                          <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${s.isCurrent ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-800 text-zinc-400'}`}>
                              <Monitor className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-zinc-200">{s.userAgent || "Unknown Device"}</p>
                                {s.isCurrent && <Badge className="bg-blue-500/10 text-blue-400 border-0 text-[10px] font-bold px-2">CURRENT</Badge>}
                              </div>
                              <p className="text-[11px] text-zinc-500">{s.ipAddress} • Last active {new Date(s.updatedAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          {!s.isCurrent && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeSession(s.token)}
                              className="text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl"
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>


                </div>
              </TabsContent>

              {/* Billing Tab */}
              <TabsContent value="billing" className="m-0 space-y-6 animate-in fade-in duration-300">
                <PersonalBillingTab />
              </TabsContent>

              {/* Notifications Tab */}
              <TabsContent value="notifications" className="m-0 space-y-8 animate-in fade-in duration-300">
                <div className="space-y-8 max-w-4xl">
                  <Card className="bg-zinc-900/30 border-zinc-800/50 shadow-sm border-white/5 rounded-xl mb-8">
                    <CardContent className="pt-6 space-y-6">
                      <Label className="text-sm font-bold text-zinc-100 block uppercase tracking-widest text-[11px]">Notification Settings</Label>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-zinc-100">Security Alerts</p>
                          <p className="text-xs text-zinc-500">Get notified about new logins and security changes.</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                      <Separator className="bg-zinc-800/50" />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-zinc-100">Product Updates</p>
                          <p className="text-xs text-zinc-500">Occasional updates about new features and improvements.</p>
                        </div>
                        <Switch />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-white border-zinc-200 text-zinc-900 rounded-2xl p-0 sm:max-w-[400px] shadow-2xl overflow-hidden border-none">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-full">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-zinc-900">
                Delete account
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-zinc-500 text-[13px] leading-relaxed">
              This action is permanent and cannot be undone. All your profile data, organizations, and RSS feeds will be removed.
            </AlertDialogDescription>
          </div>

          <div className="bg-zinc-50/50 p-4 px-6 flex justify-end gap-3 border-t border-zinc-100">
            <AlertDialogCancel className="h-9 px-4 text-zinc-500 hover:text-zinc-900 font-semibold hover:bg-transparent bg-transparent border-none shadow-none m-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              className="h-9 px-4 font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all active:scale-95 border-none m-0 rounded-lg flex items-center justify-center"
            >
              {isDeletingAccount ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isContactDialogOpen} onOpenChange={setIsContactDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800 rounded-xl p-0 overflow-hidden">
          <div className="p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-xl font-bold text-zinc-100">Contact Us</DialogTitle>
              <DialogDescription className="text-sm text-zinc-500">
                Send us a request to upgrade your plan. We'll get back to you shortly.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleContactSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Name</Label>
                <Input
                  id="name"
                  value={contactForm.name}
                  onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                  className="bg-zinc-900/50 border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={contactForm.email}
                  onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                  className="bg-zinc-900/50 border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company" className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Company Name</Label>
                <Input
                  id="company"
                  value={contactForm.company}
                  onChange={e => setContactForm({ ...contactForm, company: e.target.value })}
                  className="bg-zinc-900/50 border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message" className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Message</Label>
                <Textarea
                  id="message"
                  value={contactForm.message}
                  onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                  className="bg-zinc-900/50 border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500/20 min-h-[100px] resize-none text-sm px-3 py-2 text-zinc-100"
                  required
                />
              </div>
              <Button type="submit" disabled={isSaving} className="w-full font-bold h-11 rounded-xl">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Send request
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
