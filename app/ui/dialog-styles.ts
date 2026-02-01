export const dialogStyles = {
  dialog:
    "w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-background shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex",
  header: "flex items-center justify-between bg-foreground px-6 py-2.5",
  headerTitle: "text-sm font-semibold text-background",
  headerClose:
    "-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-background/50 transition-colors hover:bg-background/10 hover:text-background disabled:opacity-50",
  body: "border-t border-border px-6 py-5",
  footer:
    "flex justify-end gap-2.5 border-t border-border bg-surface/50 px-6 py-2.5",
  cancelBtn:
    "rounded-lg border border-border bg-background px-3.5 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-surface active:bg-surface-bright disabled:opacity-50",
  primaryBtn:
    "rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-medium text-background shadow-sm transition-colors hover:bg-foreground/85 active:bg-foreground/70 disabled:opacity-50",
  secondaryBtn:
    "rounded-lg px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground hover:bg-surface",
};
