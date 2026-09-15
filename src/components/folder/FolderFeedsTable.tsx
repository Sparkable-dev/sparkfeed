import * as React from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  flexRender,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import {
  ArrowUpDown,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import type {
  CellData,
  ColumnDef,
  RowData,
  SortingState,
  TableFeatures,
} from "@tanstack/react-table"
import type { ManagedSource } from "@/server/rss"
import { timeAgo } from "@/lib/time-ago"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"

declare module "@tanstack/react-table" {
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue extends CellData = CellData,
  > {
    /** Applied to this column's header and every one of its cells. */
    className?: string
  }
}

const folderFeedsTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },
})

type FolderFeedsTableFeatures = typeof folderFeedsTableFeatures


function SortableHeader({
  label,
  column,
}: {
  label: string

  column: any
}) {
  return (
    <button
      className="-ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="size-3 opacity-50" />
    </button>
  )
}

function TypeBadge({ type }: { type: ManagedSource["type"] }) {
  const rss = type === "rss"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
              rss
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/20 bg-amber-500/10 text-amber-400"
            }`}
          />
        }
      >
        {rss ? "RSS" : "Scraped"}
      </TooltipTrigger>
      <TooltipContent>
        {rss
          ? "This site publishes a feed, so we read it directly."
          : "No feed on this site, so we read the page and pick out posts."}
      </TooltipContent>
    </Tooltip>
  )
}

function StatusCell({ source }: { source: ManagedSource }) {
  if (source.lastError) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400" />
          }
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          Failing
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">Last failed {timeAgo(source.lastErrorAt)}</p>
          <p className="mt-1 text-muted-foreground">{source.lastError}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  if (!source.lastFetchedAt) {
    return <span className="text-xs text-muted-foreground">Not checked yet</span>
  }

  return <span className="text-xs text-emerald-400">OK</span>
}

export function FolderFeedsTable({
  sources,
  onEdit,
  onDelete,
}: {
  sources: Array<ManagedSource>
  onEdit: (source: ManagedSource) => void
  onDelete: (source: ManagedSource) => void
}) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [filter, setFilter] = React.useState("")

  const columns = React.useMemo<
    Array<ColumnDef<FolderFeedsTableFeatures, ManagedSource>>
  >(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader label="Source" column={column} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">
              {row.original.name}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {row.original.url}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: ({ column }) => <SortableHeader label="Type" column={column} />,
        cell: ({ row }) => <TypeBadge type={row.original.type} />,
      },
      {
        accessorKey: "articleCount",
        // A phone has room for the source, what kind it is, and whether it is
        // working. Counts and timestamps are the parts that give way.
        meta: { className: "hidden md:table-cell" },
        header: ({ column }) => <SortableHeader label="Articles" column={column} />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-foreground">
            {row.original.articleCount}
          </span>
        ),
      },
      {
        accessorKey: "lastFetchedAt",
        meta: { className: "hidden md:table-cell" },
        header: ({ column }) => <SortableHeader label="Last checked" column={column} />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {timeAgo(row.original.lastFetchedAt)}
          </span>
        ),
      },
      {
        id: "status",
        header: () => <span className="text-xs font-semibold text-muted-foreground">Status</span>,
        cell: ({ row }) => <StatusCell source={row.original} />,
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const source = row.original
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" />
                  }
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="mr-2 size-4" /> Open source
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => copyText(source.url, { successMessage: "URL copied" })}
                  >
                    <Link2 className="mr-2 size-4" /> Copy URL
                  </DropdownMenuItem>
                  {/* Only RSS feeds have an editor; a scraped source has no
                      settings beyond its URL. */}
                  {source.type === "rss" && (
                    <DropdownMenuItem onClick={() => onEdit(source)}>
                      <Pencil className="mr-2 size-4" /> Edit feed
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(source)}
                    className="text-red-500 focus:text-red-500"
                  >
                    <Trash2 className="mr-2 size-4" /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [onEdit, onDelete]
  )

  const table = useTable({
    // v9 requires each feature and row model to be selected explicitly.
    features: folderFeedsTableFeatures,
    data: sources,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
  })

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Filter sources…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-8 max-w-xs border-border bg-background/60 text-xs"
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-9 ${header.column.columnDef.meta?.className ?? ""}`}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-border">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`py-2.5 ${cell.column.columnDef.meta?.className ?? ""}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-20 text-center text-sm text-muted-foreground">
                  {sources.length === 0
                    ? "No sources in this folder yet."
                    : "No sources match that filter."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
