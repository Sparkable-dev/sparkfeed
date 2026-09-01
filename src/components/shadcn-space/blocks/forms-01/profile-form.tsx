import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const ProfileForm = () => {
  return (
    <section className="bg-muted py-8 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-8 xl:px-16">
        <div className="flex w-full flex-col items-center gap-8">
          <a href="#">
            <img
              src="https://images.shadcnspace.com/assets/logo/shadcnspace-logo-black.svg"
              alt="shadcnspace"
              className="dark:hidden"
            />
            <img
              src="https://images.shadcnspace.com/assets/logo/shadcnspace-logo-white.svg"
              alt="shadcnspace"
              className="hidden dark:block"
            />
          </a>
          <Card className="w-full max-w-3xl gap-0 p-0">
            <CardHeader className="gap-6 border-b border-border px-6 pt-4 pb-4">
              <h2 className="text-base font-medium text-card-foreground">
                Edit your profile
              </h2>
            </CardHeader>
            <CardContent className="px-6 py-4">
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="order-last w-full max-w-md border-border sm:order-first sm:border-e md:pe-10">
                  <form className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4">
                      <Field className="gap-1.5">
                        <FieldLabel
                          htmlFor="fullname"
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Full Name
                        </FieldLabel>
                        <Input
                          id="fullname"
                          type="text"
                          defaultValue="Sunil Joshi"
                          className="h-9 text-sm font-normal text-muted-foreground shadow-xs dark:bg-background"
                        />
                      </Field>
                      <Field className="gap-1.5">
                        <FieldLabel
                          htmlFor="email"
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Email
                        </FieldLabel>
                        <Input
                          id="email"
                          type="email"
                          defaultValue="suniljoshi19@shadcnspace.com"
                          className="h-9 text-sm font-normal text-muted-foreground shadow-xs dark:bg-background"
                        />
                      </Field>
                      <Field className="gap-1.5">
                        <FieldLabel
                          htmlFor="title"
                          className="text-sm font-normal text-muted-foreground"
                        >
                          Title
                        </FieldLabel>
                        <Input
                          id="title"
                          type="text"
                          defaultValue="UI/UX Designer"
                          className="h-9 text-sm font-normal text-muted-foreground shadow-xs dark:bg-background"
                        />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-6">
                        <div className="flex flex-col gap-1">
                          <Label
                            htmlFor="hireme"
                            className="text-sm font-medium text-primary"
                          >
                            Hire me
                          </Label>
                          <p className="text-sm font-normal text-muted-foreground">
                            Enabling this feature will allow other users to
                            contact you with work inquiries.
                          </p>
                        </div>
                        <Switch id="hireme" />
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="flex flex-col gap-1">
                          <Label
                            htmlFor="privacy"
                            className="text-sm font-medium text-primary"
                          >
                            Privacy
                          </Label>
                          <p className="text-sm font-normal text-muted-foreground">
                            Enabling privacy will hide your profile, only you
                            will be able to see it. Not recommended if you’re an
                            author.
                          </p>
                        </div>
                        <Switch id="privacy" />
                      </div>
                    </div>
                  </form>
                </div>
                <div className="flex-1">
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                      <h6 className="text-sm font-medium text-primary">
                        Avatar
                      </h6>
                      <p className="text-sm font-normal text-muted-foreground">
                        By clicking this checkbox, you agree to the terms and
                        conditions.
                      </p>
                    </div>
                    <img
                      src="https://images.shadcnspace.com/assets/profiles/profile-user.svg"
                      alt="user-profile"
                      className="mx-auto h-30 w-30 rounded-full"
                    />
                    <div className="flex flex-col items-center">
                      <h5 className="text-base font-medium text-primary">
                        Sunil Joshi
                      </h5>
                      <p className="text-sm font-normal text-muted-foreground">
                        UI/UX Designer
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-start justify-between gap-5 border-t border-border bg-card px-6 py-5 sm:flex-row sm:items-center [.border-t]:pt-5">
              <p className="text-sm font-normal text-muted-foreground">
                Last updated: 17 Jan, 2026
              </p>
              <div className="flex items-center gap-3">
                <Button
                  variant={"outline"}
                  className="h-9 cursor-pointer rounded-lg shadow-xs"
                >
                  Cancel
                </Button>
                <Button className="h-9 cursor-pointer rounded-lg hover:bg-primary/80">
                  Save Changes
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  )
}

export default ProfileForm
