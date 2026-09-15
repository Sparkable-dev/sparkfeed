import * as React from "react"
import { toast } from "sonner"
import { Loader2, Plus, Sparkles, Upload } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface CreateWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceModal({ open, onOpenChange }: CreateWorkspaceModalProps) {
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [logo, setLogo] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Auto-generate slug from name
  React.useEffect(() => {
    const generatedSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    setSlug(generatedSlug)
  }, [name])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !slug) return

    setIsSubmitting(true)
    try {
      const { error } = await authClient.organization.create({
        name,
        slug,
        logo: logo || undefined,
      })

      if (error) {
        toast.error(error.message || "Failed to create workspace")
      } else {
        toast.success("Workspace created successfully!")
        onOpenChange(false)
        // Refresh to show new workspace
        window.location.href = "/"
      }
    } catch (err) {
      toast.error("An unexpected error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File is too large. Max 10MB.")
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogo(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden bg-card dark:bg-black border-border dark:border-zinc-900 shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-xl border-border dark:border-white/5 flex flex-col">
        <div className="p-8">
          <DialogHeader className="mb-8">
            <DialogTitle className="text-3xl font-black text-foreground dark:text-zinc-100 tracking-tight">
              Create Workspace
            </DialogTitle>
            <DialogDescription className="text-muted-foreground dark:text-zinc-500 mt-1">
              Set up your new team environment
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-8">
            {/* Logo Section */}
            <div className="space-y-4">
              <Label className="text-[11px] font-bold text-muted-foreground dark:text-zinc-500 uppercase tracking-widest">Logo</Label>
              <div className="flex items-center gap-6">
                <div className="relative group">
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-border dark:border-zinc-800 bg-card dark:bg-zinc-900/30 text-muted-foreground dark:text-zinc-500 shadow-xl overflow-hidden">
                    {logo ? (
                      <img src={logo} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <Upload className="h-6 w-6" />
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={handleLogoUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-10 px-6 rounded-xl border-border dark:border-zinc-800 bg-muted dark:bg-white/5 text-xs font-bold hover:bg-accent dark:hover:bg-white/10 transition-all"
                    >
                      Upload Picture
                    </Button>
                    {logo && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setLogo(null)}
                        className="h-10 px-4 rounded-xl text-xs font-bold text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground dark:text-zinc-600 font-medium">Recommended size 1:1, up to 10MB.</p>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[11px] font-bold text-muted-foreground dark:text-zinc-500 uppercase tracking-widest">Workspace Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Acme Corp"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 rounded-xl border-input dark:border-zinc-800 bg-card dark:bg-zinc-950/50 px-4 text-foreground dark:text-zinc-100 placeholder:text-muted-foreground dark:placeholder:text-zinc-600 border-input dark:border-white/5 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug" className="text-[11px] font-bold text-muted-foreground dark:text-zinc-500 uppercase tracking-widest">Workspace Slug</Label>
                <Input
                  id="slug"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="h-12 rounded-xl border-input dark:border-zinc-800 bg-card dark:bg-zinc-950/50 px-4 text-foreground dark:text-zinc-100 placeholder:text-muted-foreground dark:placeholder:text-zinc-600 border-input dark:border-white/5 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  required
                />
              </div>
            </div>

            <div className="pt-4">
              <Button
                type="submit"
                disabled={isSubmitting || !name || !slug}
                className="w-full h-12 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-xl shadow-blue-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create Workspace
              </Button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-auto border-t border-border dark:border-zinc-900/50 bg-card dark:bg-zinc-950/50 p-6 flex items-center justify-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground dark:text-zinc-600 uppercase tracking-widest">Powered by</span>
          <div className="flex items-center gap-1.5 text-muted-foreground dark:text-zinc-400">
            <Sparkles className="h-3 w-3 text-blue-500 fill-blue-500" />
            <span className="text-[11px] font-black tracking-tight text-foreground dark:text-zinc-200">SPARKFEED</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
