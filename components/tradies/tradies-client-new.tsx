// "use client";

// import { ReactNode, useEffect, useMemo, useState } from "react";
// import { TradieScheduleStatus } from "@prisma/client";
// import {
//   AlertTriangle,
//   Calendar,
//   CalendarDays,
//   Check,
//   CheckCircle2,
//   CircleAlert,
//   Clock10,
//   Download,
//   EllipsisVertical,
//   Eye,
//   Loader2,
//   Mail,
//   Phone,
//   PhoneCall,
//   Search,
//   TriangleAlert,
//   Users,
//   Plus,
//   Star,
// } from "lucide-react";

// import { DonutChartCard } from "@/components/charts/donut-chart-card";
// import { HorizontalBarChartCard } from "@/components/charts/horizontal-bar-chart-card";
// import { MetricCard } from "@/components/common/metric-card";
// import { SearchableSelect } from "@/components/common/searchable-select";
// import { StatusPill } from "@/components/common/status-pill";
// import { Button } from "@/components/ui/button";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import {
//   Pagination,
//   PaginationContent,
//   PaginationEllipsis,
//   PaginationItem,
//   PaginationLink,
//   PaginationNext,
//   PaginationPrevious,
// } from "@/components/ui/pagination";
// import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
// import {
//   clearSelectedSchedules,
//   fetchTradieCoordinationDashboard,
//   fetchTradieProjectLookup,
//   hydrateTradieCoordination,
//   setSelectedSchedules,
//   setTradieFilters,
//   setTradiePage,
//   setTradies,
//   toggleScheduleSelection,
//   updateTradieScheduleStatus,
// } from "@/lib/store/slices/tradiesSlice";
// import { openModal } from "@/lib/store/slices/uiSlice";
// import type {
//   SafeTradie,
//   TradieCoordinationDashboard,
//   TradieScheduleListItem,
//   TradieUrgentReminderItem,
// } from "@/types/project";
// import { dataTimeFormat, dateFormat } from "@/utils/formatters";
// import { DataTable } from "../common/data-table";
// import { cn } from "@/lib/utils";
// import { toast } from "sonner";
// import { daysUntil } from "@/utils/parser";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "../ui/select";

// const statusLabelMap: Record<TradieScheduleStatus, string> = {
//   PENDING: "Pending",
//   PENDING_RESPONSE: "Pending Response",
//   CONFIRMED: "Confirmed",
//   NO_RESPONSE: "No Response",
//   DECLINED: "Declined",
//   COMPLETED: "Completed",
// };

// const statusToneMap: Record<
//   TradieScheduleStatus,
//   "success" | "warning" | "danger" | "neutral"
// > = {
//   PENDING: "warning",
//   PENDING_RESPONSE: "warning",
//   CONFIRMED: "success",
//   NO_RESPONSE: "danger",
//   DECLINED: "danger",
//   COMPLETED: "neutral",
// };

// function CalanderRow(scheduledData: string): ReactNode {
//   const daysLeft = daysUntil(scheduledData);

//   if (daysLeft < 0) {
//     return (
//       <>
//         <CircleAlert className="h-4 w-4 text-gray-500" />
//         <span>{Math.abs(daysLeft)}d overdue</span>
//       </>
//     );
//   }

//   if (daysLeft === 0) {
//     return (
//       <>
//         <CircleAlert className="h-4 w-4 text-red-600" />
//         <span>Due today</span>
//       </>
//     );
//   }

//   if (daysLeft <= 4) {
//     return (
//       <>
//         <TriangleAlert className="h-4 w-4 text-amber-600" />
//         <span>{daysLeft}d left</span>
//       </>
//     );
//   }

//   return (
//     <>
//       <Calendar className="h-4 w-4 text-green-600" />
//       <span>{daysLeft}d left</span>
//     </>
//   );
// }

// function LoadingSkeleton() {
//   return (
//     <div className="space-y-3">
//       <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
//       <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
//       <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
//     </div>
//   );
// }

// export function TradiesClientNew({
//   initialDashboard,
//   initialTradies,
// }: {
//   initialDashboard: TradieCoordinationDashboard;
//   initialTradies: SafeTradie[];
// }) {
//   const dispatch = useAppDispatch();
//   const tradiesState = useAppSelector((state) => state.tradies);

//   const [searchInput, setSearchInput] = useState(initialDashboard.query.search);
//   const [projectSearch, setProjectSearch] = useState("");
//   const [urgentCollapsed, setUrgentCollapsed] = useState(false);
//   const [bulkLoading, setBulkLoading] = useState<"confirm" | "pending" | null>(
//     null,
//   );

//   useEffect(() => {
//     dispatch(setTradies(initialTradies));
//     dispatch(hydrateTradieCoordination(initialDashboard));
//   }, [dispatch, initialDashboard, initialTradies]);

//   useEffect(() => {
//     const timer = window.setTimeout(() => {
//       dispatch(setTradieFilters({ search: searchInput }));
//     }, 250);

//     return () => window.clearTimeout(timer);
//   }, [dispatch, searchInput]);

//   useEffect(() => {
//     const timer = window.setTimeout(() => {
//       void dispatch(
//         fetchTradieProjectLookup({
//           page: 1,
//           limit: tradiesState.projectLookup.limit,
//           query: projectSearch,
//         }),
//       );
//     }, 250);

//     return () => window.clearTimeout(timer);
//   }, [dispatch, projectSearch, tradiesState.projectLookup.limit]);

//   useEffect(() => {
//     void dispatch(fetchTradieCoordinationDashboard());
//   }, [
//     dispatch,
//     tradiesState.filters.projectId,
//     tradiesState.filters.search,
//     tradiesState.filters.sortBy,
//     tradiesState.filters.sortOrder,
//     tradiesState.filters.status,
//     tradiesState.filters.tab,
//     tradiesState.filters.tradeType,
//     tradiesState.pagination.limit,
//     tradiesState.pagination.page,
//   ]);

//   const selectedProject = useMemo(() => {
//     if (!tradiesState.filters.projectId) {
//       return null;
//     }

//     const existing = tradiesState.projectLookup.items.find(
//       (item) => item.id === tradiesState.filters.projectId,
//     );
//     if (existing) {
//       return existing;
//     }

//     const fallback = tradiesState.schedules.find(
//       (item) => item.projectId === tradiesState.filters.projectId,
//     );
//     if (!fallback) {
//       return null;
//     }

//     return {
//       id: fallback.projectId,
//       name: fallback.projectName,
//       description: "Current filter",
//     };
//   }, [
//     tradiesState.filters.projectId,
//     tradiesState.projectLookup.items,
//     tradiesState.schedules,
//   ]);

//   const tableRowsSelected = tradiesState.schedules.filter((row) =>
//     tradiesState.selectedScheduleIds.includes(row.id),
//   );

//   const pageItems = useMemo(() => {
//     const total = tradiesState.pagination.totalPages;
//     const current = tradiesState.pagination.page;

//     if (total <= 7) {
//       return Array.from({ length: total }, (_, index) => index + 1);
//     }

//     const items: Array<number | "ellipsis"> = [1];
//     const start = Math.max(2, current - 1);
//     const end = Math.min(total - 1, current + 1);

//     if (start > 2) items.push("ellipsis");
//     for (let page = start; page <= end; page += 1) items.push(page);
//     if (end < total - 1) items.push("ellipsis");
//     items.push(total);

//     return items;
//   }, [tradiesState.pagination.page, tradiesState.pagination.totalPages]);

//   const updateScheduleStatuses = async (
//     ids: string[],
//     status: TradieScheduleStatus,
//   ) => {
//     if (ids.length === 0) return;

//     await Promise.all(
//       ids.map(async (id) =>
//         dispatch(
//           // dispatch individual update thunks to keep UI reactive
//           updateTradieScheduleStatus({ scheduleId: id, status }),
//         ).unwrap(),
//       ),
//     );

//     dispatch(clearSelectedSchedules());
//   };

//   const handleBulkConfirm = async () => {
//     setBulkLoading("confirm");
//     await updateScheduleStatuses(
//       tradiesState.selectedScheduleIds,
//       TradieScheduleStatus.CONFIRMED,
//     );
//     setBulkLoading(null);
//   };

//   const handleBulkReminder = async () => {
//     const valid = tableRowsSelected.filter(
//       (row) =>
//         row.status !== TradieScheduleStatus.CONFIRMED &&
//         row.status !== TradieScheduleStatus.COMPLETED,
//     );
//     setBulkLoading("pending");
//     await updateScheduleStatuses(
//       valid.map((row) => row.id),
//       TradieScheduleStatus.PENDING_RESPONSE,
//     );
//     setBulkLoading(null);
//   };

//   const handleRowQuickConfirm = async (row: TradieScheduleListItem) => {
//     const loading = toast.loading("Updating status...");
//     try {
//       await updateScheduleStatuses([row.id], TradieScheduleStatus.CONFIRMED);
//       toast.success("Status updated to Confirmed", { id: loading });
//     } catch (error) {
//       toast.error("Failed to update status. Please try again.", {
//         id: loading,
//       });
//       console.error("Error updating tradie schedule status:", error);
//     } finally {
//       toast.dismiss(loading);
//     }
//   };

//   const handleUpdateRowStatus = (row: TradieScheduleListItem) => {
//     dispatch(openModal({ type: "confirmStatus", payload: { schedule: row } }));
//   };

//   const handleViewScheduleDetails = (row: TradieUrgentReminderItem) => {
//     dispatch(
//       openModal({ type: "tradieScheduleDetails", payload: { schedule: row } }),
//     );
//   };

//   const handleRowReminder = async (row: TradieScheduleListItem) => {
//     dispatch(openModal({ type: "tradieReminder", payload: { schedule: row } }));
//   };

//   const handleRowCallLogged = async (row: TradieScheduleListItem) => {
//     dispatch(openModal({ type: "logCall", payload: { schedule: row } }));
//   };

//   const exportCsv = () => {
//     const headers = [
//       "Tradie",
//       "Trade",
//       "Project",
//       "Task",
//       "Scheduled",
//       "Duration",
//       "Status",
//     ];
//     const rows = tradiesState.schedules.map((row) => [
//       row.tradieName,
//       row.tradeType,
//       row.projectName,
//       row.taskLabel,
//       dateFormat.format(new Date(row.scheduledDate)),
//       `${row.durationDays}`,
//       statusLabelMap[row.status],
//     ]);

//     const csv = [headers, ...rows]
//       .map((line) =>
//         line
//           .map((value) => `"${String(value).replaceAll('"', '""')}"`)
//           .join(","),
//       )
//       .join("\n");

//     const blob = new Blob([csv], { type: "text/csv" });
//     const url = URL.createObjectURL(blob);
//     const anchor = document.createElement("a");
//     anchor.href = url;
//     anchor.download = `tradie-coordination-${new Date().toISOString().slice(0, 10)}.csv`;
//     document.body.appendChild(anchor);
//     anchor.click();
//     document.body.removeChild(anchor);
//     URL.revokeObjectURL(url);
//   };

//   const renderScheduleActions = (
//     row: TradieScheduleListItem,
//     large = false,
//   ) => {
//     const size = large ? "icon" : "sm";
//     const btn = large ? "h-10 w-10" : "";
//     return (
//       <div
//         key={`actions-${row.id}`}
//         className="flex justify-start gap-1"
//         onClick={(event) => event.stopPropagation()}
//       >
//         {(row.status === TradieScheduleStatus.PENDING ||
//           row.status === TradieScheduleStatus.NO_RESPONSE ||
//           row.status === TradieScheduleStatus.PENDING_RESPONSE) && (
//           <Button
//             size={size}
//             variant="ghost"
//             className={btn}
//             aria-label="Log call"
//             onClick={() => void handleRowCallLogged(row)}
//           >
//             <Phone className="h-4 w-4" />
//           </Button>
//         )}

//         {row.status !== TradieScheduleStatus.CONFIRMED &&
//           row.status !== TradieScheduleStatus.COMPLETED && (
//             <Button
//               size={size}
//               variant="ghost"
//               className={btn}
//               aria-label="Mark confirmed"
//               onClick={() => void handleRowQuickConfirm(row)}
//             >
//               <Check className="h-4 w-4" />
//             </Button>
//           )}

//         {row.status !== TradieScheduleStatus.COMPLETED && (
//           <Button
//             size={size}
//             variant="ghost"
//             className={btn}
//             aria-label="Send reminder"
//             onClick={() => void handleRowReminder(row)}
//           >
//             <Mail className="h-4 w-4" />
//           </Button>
//         )}
//         {row.status === TradieScheduleStatus.COMPLETED && (
//           <Button
//             size={size}
//             variant="ghost"
//             className={btn}
//             disabled
//             aria-label="Completed"
//           >
//             <CheckCircle2 className="h-4 w-4 text-green-500" />
//           </Button>
//         )}

//         <Button
//           size={size}
//           variant="ghost"
//           className={btn}
//           aria-label="More actions"
//           disabled={row.status === TradieScheduleStatus.COMPLETED}
//           onClick={() => void handleUpdateRowStatus(row)}
//         >
//           <EllipsisVertical className="h-4 w-4" />
//         </Button>
//       </div>
//     );
//   };

//   const daysLeftBadgeClass = (scheduledDate: string) =>
//     [
//       "rounded-md px-2 py-1 text-xs font-semibold flex gap-2 items-center",
//       daysUntil(scheduledDate) <= 2
//         ? "bg-red-100 text-red-700"
//         : daysUntil(scheduledDate) <= 7
//           ? "bg-amber-100 text-amber-700"
//           : "bg-slate-100 text-slate-700",
//     ].join(" ");

//   const scheduleTableHeaders = [
//     <input
//       key="select-all"
//       type="checkbox"
//       checked={
//         tradiesState.schedules.length > 0 &&
//         tradiesState.selectedScheduleIds.length ===
//           tradiesState.schedules.length
//       }
//       onChange={(event) => {
//         if (event.target.checked) {
//           dispatch(
//             setSelectedSchedules(tradiesState.schedules.map((row) => row.id)),
//           );
//         } else {
//           dispatch(clearSelectedSchedules());
//         }
//       }}
//     />,
//     "Tradie",
//     "Trade",
//     "Project",
//     "Task",
//     "Scheduled",
//     "Days Left",
//     "Status",
//     "Actions",
//   ];

//   const scheduleTableRows = tradiesState.schedules.map((row) => [
//     <input
//       key={`select-${row.id}`}
//       type="checkbox"
//       checked={tradiesState.selectedScheduleIds.includes(row.id)}
//       onChange={() => dispatch(toggleScheduleSelection(row.id))}
//       onClick={(event) => event.stopPropagation()}
//     />,

//     <div key={`tradie-${row.id}`}>
//       <p className="font-semibold text-slate-900">{row.tradieName}</p>
//       <p className="text-xs text-muted-foreground">{row.abn}</p>
//     </div>,

//     row.tradeType,

//     row.projectName,

//     row.taskLabel,

//     <div key={`schedule-${row.id}`}>
//       <p className="font-medium">
//         {dateFormat.format(new Date(row.scheduledDate))}
//       </p>
//       <p className="text-xs text-muted-foreground">{row.durationDays} day(s)</p>
//     </div>,

//     <span
//       key={`days-${row.id}`}
//       className={daysLeftBadgeClass(row.scheduledDate)}
//     >
//       {CalanderRow(row.scheduledDate)}
//     </span>,

//     <StatusPill
//       key={`status-${row.id}`}
//       id={`status-${row.id}`}
//       tone={statusToneMap[row.status]}
//     >
//       {statusLabelMap[row.status]}
//     </StatusPill>,

//     renderScheduleActions(row),
//   ]);

//   return (
//     <div className="space-y-6">
//       <Card className="overflow-hidden border-teal-100 bg-gradient-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
//         <CardContent className="relative p-6">
//           <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
//           <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
//           <div className="relative flex flex-wrap items-center justify-between gap-3">
//             <div>
//               <h2 className="text-lg font-extrabold text-slate-900">
//                 Tradie Management
//               </h2>
//               <p className="text-sm text-slate-600">
//                 Browse by trade category or switch views. Add, track incidents,
//                 update priority levels, and update pricing.
//               </p>
//             </div>
//             <div className="flex flex-wrap gap-2">
//               <Button
//                 onClick={() => dispatch(openModal({ type: "addTradie" }))}
//               >
//                 <Plus className="mr-2 size-4" />
//                 Add Tradie
//               </Button>

//               <Button variant="outline" onClick={exportCsv}>
//                 <Download className="mr-2 size-4" />
//                 Export
//               </Button>
//             </div>
//           </div>
//         </CardContent>
//       </Card>

//       {tradiesState.summary ? (
//         <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
//           <MetricCard
//             title="Registered Tradies"
//             value={tradiesState.summary.registeredTradies}
//             trendDelta={tradiesState.summary.registeredTrendDelta}
//             Icon={Users}
//             iconTone="bg-teal-600"
//           />
//           <MetricCard
//             title="Incidents Logged"
//             value={tradiesState.summary.inactiveTradies}
//             Icon={AlertTriangle}
//             iconTone="bg-red-500"
//           />
//           <MetricCard
//             title="Favourites"
//             value={tradiesState.summary.scheduledThisWeek}
//             trendDelta={tradiesState.summary.scheduledWeekDelta}
//             Icon={Star}
//             iconTone="bg-orange-500"
//           />
//         </div>
//       ) : null}

//       <div className="flex cursor-pointer items-center justify-between rounded-xl border border-red-200 bg-red-50 px-5 py-4 transition-colors hover:bg-red-100">
//         <div className="flex items-center gap-4">
//           <div className="grid size-10 place-items-center rounded-full bg-red-500 text-white">
//             <TriangleAlert className="size-5" />
//           </div>
//           <div>
//             <p className="text-sm font-bold text-red-800">
//               {tradiesState.summary?.inactiveTradies} Unresolved Incidents
//             </p>
//             <p className="mt-0.5 text-xs text-red-600/80">
//               Click to view flagged tradies in table view
//             </p>
//           </div>
//         </div>
//         {/* <svg
//           className="size-5 text-red-400"
//           viewBox="0 0 24 24"
//           fill="none"
//           stroke="currentColor"
//           strokeWidth="2"
//           strokeLinecap="round"
//           strokeLinejoin="round"
//         >
//           <path d="M9 18l6-6-6-6" />
//         </svg> */}
//       </div>

//       <Card className="border-border/70 bg-white/95 shadow-sm">
//         <CardHeader className="border-b border-border/70 px-5 py-4">
//           <div className="space-y-4">
//             <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-4">
//               {(
//                 [
//                   "all",
//                   "week",
//                   "confirmed",
//                   "pending",
//                   "overdue",
//                   "completed",
//                 ] as const
//               ).map((tab) => {
//                 const active = tradiesState.filters.tab === tab;

//                 return (
//                   <button
//                     key={tab}
//                     onClick={() => dispatch(setTradieFilters({ tab }))}
//                     className={cn(
//                       "group relative inline-flex h-9 items-center rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
//                       active
//                         ? "bg-teal-50 text-teal-700 shadow-sm"
//                         : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
//                     )}
//                   >
//                     <span>
//                       {tab === "all"
//                         ? "All"
//                         : tab === "week"
//                           ? "Next 7 Days"
//                           : tab.charAt(0).toUpperCase() + tab.slice(1)}
//                     </span>

//                     <span
//                       className={cn(
//                         "ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold transition-colors",
//                         active
//                           ? "bg-teal-600 text-white"
//                           : "bg-muted text-muted-foreground group-hover:bg-background",
//                       )}
//                     >
//                       {tradiesState.tabCounts[tab]}
//                     </span>

//                     {active && (
//                       <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
//                     )}
//                   </button>
//                 );
//               })}
//             </div>

//             <div className="flex flex-wrap items-center gap-2">
//               <div className="relative max-w-[280px] flex-1">
//                 <label htmlFor="search" className="sr-only">
//                   Search
//                 </label>

//                 <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

//                 <Input
//                   id="search"
//                   className="h-10 rounded-lg border-border bg-background pl-9 text-[13px] shadow-none transition-all focus-visible:ring-4 focus-visible:ring-teal-500/10 focus-visible:border-teal-600"
//                   placeholder="Search tradies, projects, trades..."
//                   value={searchInput}
//                   onChange={(event) => setSearchInput(event.target.value)}
//                 />
//               </div>

//               <div className="min-w-[180px] flex-1 lg:max-w-[220px]">
//                 <SearchableSelect
//                   label=""
//                   placeholder="All Projects"
//                   searchValue={projectSearch}
//                   selectedItem={selectedProject}
//                   items={tradiesState.projectLookup.items}
//                   loading={
//                     tradiesState.projectLookup.loading ||
//                     tradiesState.projectLookup.loadingMore
//                   }
//                   hasMore={
//                     tradiesState.projectLookup.page <
//                     tradiesState.projectLookup.totalPages
//                   }
//                   onQueryChange={setProjectSearch}
//                   onSelect={(item) => {
//                     dispatch(setTradieFilters({ projectId: item.id }));
//                   }}
//                   onClear={() =>
//                     dispatch(setTradieFilters({ projectId: null }))
//                   }
//                   onLoadMore={() => {
//                     void dispatch(
//                       fetchTradieProjectLookup({
//                         page: tradiesState.projectLookup.page + 1,
//                         limit: tradiesState.projectLookup.limit,
//                         query: projectSearch,
//                       }),
//                     );
//                   }}
//                 />
//               </div>

//               <Select
//                 value={tradiesState.filters.tradeType ?? "all"}
//                 onValueChange={(value) =>
//                   dispatch(
//                     setTradieFilters({
//                       tradeType: value === "all" ? null : value,
//                     }),
//                   )
//                 }
//               >
//                 <SelectTrigger className="h-9 min-w-[160px] rounded-md border-border bg-background text-[12.5px] font-medium shadow-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:ring-offset-0">
//                   <SelectValue placeholder="All Trades" />
//                 </SelectTrigger>

//                 <SelectContent>
//                   <SelectItem value="all">All Trades</SelectItem>

//                   {tradiesState.tradeOptions.map((trade) => (
//                     <SelectItem key={trade} value={trade}>
//                       {trade}
//                     </SelectItem>
//                   ))}
//                 </SelectContent>
//               </Select>

//               <Select
//                 value={tradiesState.filters.status ?? "all"}
//                 onValueChange={(value) =>
//                   dispatch(
//                     setTradieFilters({
//                       status:
//                         value === "all"
//                           ? null
//                           : (value as TradieScheduleStatus),
//                     }),
//                   )
//                 }
//               >
//                 <SelectTrigger className="h-9 min-w-[160px] rounded-md border-border bg-background text-[12.5px] font-medium shadow-none transition-all focus:ring-4 focus:ring-teal-500/10 focus:ring-offset-0">
//                   <SelectValue placeholder="All Statuses" />
//                 </SelectTrigger>

//                 <SelectContent>
//                   <SelectItem value="all">All Status</SelectItem>

//                   {Object.entries(statusLabelMap).map(([status, label]) => (
//                     <SelectItem key={status} value={status}>
//                       {label}
//                     </SelectItem>
//                   ))}
//                 </SelectContent>
//               </Select>

//               <p className="ml-auto whitespace-nowrap text-[12px] font-medium text-muted-foreground">
//                 {tradiesState.pagination.totalCount} results
//               </p>
//             </div>
//           </div>
//         </CardHeader>

//         <CardContent className="pt-4">
//           {tradiesState.loading ? <LoadingSkeleton /> : null}

//           {!tradiesState.loading && tradiesState.error ? (
//             <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
//               {tradiesState.error}
//             </div>
//           ) : null}

//           {!tradiesState.loading &&
//           !tradiesState.error &&
//           tradiesState.schedules.length === 0 ? (
//             <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
//               No tradies match your current filters.
//             </div>
//           ) : null}

//           {!tradiesState.loading &&
//           !tradiesState.error &&
//           tradiesState.schedules.length > 0 ? (
//             <>
//               <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
//                 <DataTable
//                   headers={scheduleTableHeaders}
//                   rows={scheduleTableRows}
//                   onRowClick={(rowIndex) => {
//                     const row = tradiesState.schedules[rowIndex];
//                     dispatch(
//                       openModal({
//                         type: "tradieScheduleDetails",
//                         payload: { schedule: row },
//                       }),
//                     );
//                   }}
//                   emptyState={
//                     <div className="flex flex-col items-center justify-center gap-3">
//                       <div className="flex size-12 items-center justify-center">
//                         <Clock10 className="size-5 text-muted-foreground" />
//                       </div>

//                       <div className="space-y-1">
//                         <p className="text-sm font-semibold text-foreground">
//                           No Tradie Schedule data available
//                         </p>

//                         <p className="text-xs text-muted-foreground">
//                           Your Tradie Schedule details will appear here.
//                         </p>
//                       </div>
//                     </div>
//                   }
//                 />
//               </div>

//               {/* Mobile card fallback */}
//               <div className="space-y-3 md:hidden">
//                 {tradiesState.schedules.map((row) => (
//                   <article
//                     key={`card-${row.id}`}
//                     role="button"
//                     tabIndex={0}
//                     aria-label={`View schedule for ${row.tradieName}`}
//                     onClick={() =>
//                       dispatch(
//                         openModal({
//                           type: "tradieScheduleDetails",
//                           payload: { schedule: row },
//                         }),
//                       )
//                     }
//                     onKeyDown={(event) => {
//                       if (event.key === "Enter" || event.key === " ") {
//                         event.preventDefault();
//                         dispatch(
//                           openModal({
//                             type: "tradieScheduleDetails",
//                             payload: { schedule: row },
//                           }),
//                         );
//                       }
//                     }}
//                     className="cursor-pointer rounded-xl border border-border/70 bg-card p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
//                   >
//                     <div className="flex items-start justify-between gap-3">
//                       <div className="flex items-start gap-3">
//                         <input
//                           type="checkbox"
//                           className="mt-1 size-4"
//                           checked={tradiesState.selectedScheduleIds.includes(
//                             row.id,
//                           )}
//                           onChange={() =>
//                             dispatch(toggleScheduleSelection(row.id))
//                           }
//                           onClick={(event) => event.stopPropagation()}
//                           aria-label={`Select ${row.tradieName}`}
//                         />
//                         <div>
//                           <p className="font-semibold text-slate-900">
//                             {row.tradieName}
//                           </p>
//                           <p className="text-xs text-muted-foreground">
//                             {row.abn}
//                           </p>
//                         </div>
//                       </div>
//                       <StatusPill
//                         id={`card-status-${row.id}`}
//                         tone={statusToneMap[row.status]}
//                       >
//                         {statusLabelMap[row.status]}
//                       </StatusPill>
//                     </div>

//                     <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
//                       <div>
//                         <dt className="text-xs text-muted-foreground">Trade</dt>
//                         <dd className="font-medium text-foreground">
//                           {row.tradeType}
//                         </dd>
//                       </div>
//                       <div>
//                         <dt className="text-xs text-muted-foreground">
//                           Project
//                         </dt>
//                         <dd className="font-medium text-foreground">
//                           {row.projectName}
//                         </dd>
//                       </div>
//                       <div>
//                         <dt className="text-xs text-muted-foreground">Task</dt>
//                         <dd className="font-medium text-foreground">
//                           {row.taskLabel}
//                         </dd>
//                       </div>
//                       <div>
//                         <dt className="text-xs text-muted-foreground">
//                           Scheduled
//                         </dt>
//                         <dd className="font-medium text-foreground">
//                           {dateFormat.format(new Date(row.scheduledDate))}
//                           <span className="text-xs text-muted-foreground">
//                             {" "}
//                             · {row.durationDays} day(s)
//                           </span>
//                         </dd>
//                       </div>
//                     </dl>

//                     <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
//                       <span className={daysLeftBadgeClass(row.scheduledDate)}>
//                         {CalanderRow(row.scheduledDate)}
//                       </span>
//                       {renderScheduleActions(row, true)}
//                     </div>
//                   </article>
//                 ))}
//               </div>

//               {tradiesState.selectedScheduleIds.length > 0 ? (
//                 <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
//                   <span className="text-sm font-semibold text-teal-700">
//                     {tradiesState.selectedScheduleIds.length} selected
//                   </span>
//                   <Button
//                     size="sm"
//                     onClick={() => void handleBulkReminder()}
//                     disabled={bulkLoading !== null}
//                   >
//                     {bulkLoading === "pending" ? (
//                       <Loader2 className="mr-2 size-4 animate-spin" />
//                     ) : null}
//                     Send Reminders
//                   </Button>
//                   <Button
//                     size="sm"
//                     variant="outline"
//                     onClick={() => void handleBulkConfirm()}
//                     disabled={bulkLoading !== null}
//                   >
//                     {bulkLoading === "confirm" ? (
//                       <Loader2 className="mr-2 size-4 animate-spin" />
//                     ) : null}
//                     Mark Confirmed
//                   </Button>
//                 </div>
//               ) : null}

//               {tradiesState.pagination.totalCount > 0 ? (
//                 <div className="space-y-2 pt-4">
//                   <p className="text-center text-xs text-muted-foreground">
//                     Showing {tradiesState.schedules.length} of{" "}
//                     {tradiesState.pagination.totalCount} schedules
//                   </p>
//                   <Pagination>
//                     <PaginationContent>
//                       <PaginationItem>
//                         <PaginationPrevious
//                           href="#"
//                           onClick={(event) => {
//                             event.preventDefault();
//                             dispatch(
//                               setTradiePage(
//                                 Math.max(1, tradiesState.pagination.page - 1),
//                               ),
//                             );
//                           }}
//                           aria-disabled={tradiesState.pagination.page === 1}
//                         />
//                       </PaginationItem>
//                       {pageItems.map((item, index) =>
//                         item === "ellipsis" ? (
//                           <PaginationItem key={`ellipsis-${index}`}>
//                             <PaginationEllipsis />
//                           </PaginationItem>
//                         ) : (
//                           <PaginationItem key={item}>
//                             <PaginationLink
//                               href="#"
//                               isActive={item === tradiesState.pagination.page}
//                               onClick={(event) => {
//                                 event.preventDefault();
//                                 dispatch(setTradiePage(item));
//                               }}
//                             >
//                               {item}
//                             </PaginationLink>
//                           </PaginationItem>
//                         ),
//                       )}
//                       <PaginationItem>
//                         <PaginationNext
//                           href="#"
//                           onClick={(event) => {
//                             event.preventDefault();
//                             dispatch(
//                               setTradiePage(
//                                 Math.min(
//                                   tradiesState.pagination.totalPages,
//                                   tradiesState.pagination.page + 1,
//                                 ),
//                               ),
//                             );
//                           }}
//                           aria-disabled={
//                             tradiesState.pagination.page >=
//                             tradiesState.pagination.totalPages
//                           }
//                         />
//                       </PaginationItem>
//                     </PaginationContent>
//                   </Pagination>
//                 </div>
//               ) : null}
//             </>
//           ) : null}
//         </CardContent>
//       </Card>
//     </div>
//   );
// }



"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { TradieScheduleStatus } from "@prisma/client";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock10,
  Download,
  EllipsisVertical,
  Eye,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  Search,
  TriangleAlert,
  Users,
  Plus,
  Star,
  LayoutGrid,
  List as ListIcon,
  Table as TableIcon,
  ChevronDown,
  Wrench,
  Zap,
  Droplet,
  Hammer,
  PaintRoller,
  HardHat,
} from "lucide-react";

import { DonutChartCard } from "@/components/charts/donut-chart-card";
import { HorizontalBarChartCard } from "@/components/charts/horizontal-bar-chart-card";
import { MetricCard } from "@/components/common/metric-card";
import { SearchableSelect } from "@/components/common/searchable-select";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  clearSelectedSchedules,
  fetchTradieCoordinationDashboard,
  fetchTradieProjectLookup,
  hydrateTradieCoordination,
  setSelectedSchedules,
  setTradieFilters,
  setTradiePage,
  setTradies,
  toggleScheduleSelection,
  updateTradieScheduleStatus,
} from "@/lib/store/slices/tradiesSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type {
  SafeTradie,
  TradieCoordinationDashboard,
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { dataTimeFormat, dateFormat } from "@/utils/formatters";
import { DataTable } from "../common/data-table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { daysUntil } from "@/utils/parser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

// --- HELPERS ---
const statusLabelMap: Record<TradieScheduleStatus, string> = {
  PENDING: "Pending",
  PENDING_RESPONSE: "Pending Response",
  CONFIRMED: "Confirmed",
  NO_RESPONSE: "No Response",
  DECLINED: "Declined",
  COMPLETED: "Completed",
};

const statusToneMap: Record<
  TradieScheduleStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  PENDING: "warning",
  PENDING_RESPONSE: "warning",
  CONFIRMED: "success",
  NO_RESPONSE: "danger",
  DECLINED: "danger",
  COMPLETED: "neutral",
};

function getCategoryTheme(trade: string, index: number) {
  const t = trade.toLowerCase();
  let icon = Wrench;
  if (t.includes("plumb")) icon = Droplet;
  else if (t.includes("electric")) icon = Zap;
  else if (t.includes("paint")) icon = PaintRoller;
  else if (t.includes("carp")) icon = Hammer;
  else if (t.includes("roof") || t.includes("build")) icon = HardHat;

  const styles = [
    { bg: "bg-blue-100", text: "text-blue-600" },
    { bg: "bg-red-100", text: "text-red-600" },
    { bg: "bg-yellow-100", text: "text-yellow-600" },
    { bg: "bg-orange-100", text: "text-orange-600" },
    { bg: "bg-purple-100", text: "text-purple-600" },
    { bg: "bg-teal-100", text: "text-teal-600" },
    { bg: "bg-amber-100", text: "text-amber-700" },
    { bg: "bg-indigo-100", text: "text-indigo-600" },
  ];
  return { icon, ...styles[index % styles.length] };
}

function CalanderRow(scheduledData: string): ReactNode {
  const daysLeft = daysUntil(scheduledData);
  if (daysLeft < 0) return <><CircleAlert className="h-4 w-4 text-gray-500" /><span>{Math.abs(daysLeft)}d overdue</span></>;
  if (daysLeft === 0) return <><CircleAlert className="h-4 w-4 text-red-600" /><span>Due today</span></>;
  if (daysLeft <= 4) return <><TriangleAlert className="h-4 w-4 text-amber-600" /><span>{daysLeft}d left</span></>;
  return <><Calendar className="h-4 w-4 text-green-600" /><span>{daysLeft}d left</span></>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
      <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
      <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export function TradiesClientNew({
  initialDashboard,
  initialTradies,
}: {
  initialDashboard: TradieCoordinationDashboard;
  initialTradies: SafeTradie[];
}) {
  const dispatch = useAppDispatch();
  const tradiesState = useAppSelector((state) => state.tradies);

  const [searchInput, setSearchInput] = useState(initialDashboard.query.search);
  const [projectSearch, setProjectSearch] = useState("");
  const [bulkLoading, setBulkLoading] = useState<"confirm" | "pending" | null>(null);
  
  // View State for the UI
  const [viewMode, setViewMode] = useState<"categories" | "list" | "table">("categories");

  // Dynamic Categories based on real data
  const dynamicCategories = useMemo(() => {
    return tradiesState.tradeOptions.map((trade, index) => {
      const theme = getCategoryTheme(trade, index);
      // Optional: Calculate jobs dynamically from current schedules or use a generic badge
      const activeJobs = tradiesState.schedules.filter((s) => s.tradeType === trade).length;
      return { name: trade, jobs: activeJobs, ...theme };
    });
  }, [tradiesState.tradeOptions, tradiesState.schedules]);

  useEffect(() => {
    dispatch(setTradies(initialTradies));
    dispatch(hydrateTradieCoordination(initialDashboard));
  }, [dispatch, initialDashboard, initialTradies]);

  useEffect(() => {
    const timer = window.setTimeout(() => dispatch(setTradieFilters({ search: searchInput })), 250);
    return () => window.clearTimeout(timer);
  }, [dispatch, searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void dispatch(fetchTradieProjectLookup({ page: 1, limit: tradiesState.projectLookup.limit, query: projectSearch }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dispatch, projectSearch, tradiesState.projectLookup.limit]);

  useEffect(() => {
    void dispatch(fetchTradieCoordinationDashboard());
  }, [
    dispatch,
    tradiesState.filters.projectId,
    tradiesState.filters.search,
    tradiesState.filters.sortBy,
    tradiesState.filters.sortOrder,
    tradiesState.filters.status,
    tradiesState.filters.tab,
    tradiesState.filters.tradeType,
    tradiesState.pagination.limit,
    tradiesState.pagination.page,
  ]);

  const selectedProject = useMemo(() => {
    if (!tradiesState.filters.projectId) return null;
    const existing = tradiesState.projectLookup.items.find((item) => item.id === tradiesState.filters.projectId);
    if (existing) return existing;
    const fallback = tradiesState.schedules.find((item) => item.projectId === tradiesState.filters.projectId);
    if (!fallback) return null;
    return { id: fallback.projectId, name: fallback.projectName, description: "Current filter" };
  }, [tradiesState.filters.projectId, tradiesState.projectLookup.items, tradiesState.schedules]);

  const tableRowsSelected = tradiesState.schedules.filter((row) => tradiesState.selectedScheduleIds.includes(row.id));

  const pageItems = useMemo(() => {
    const total = tradiesState.pagination.totalPages;
    const current = tradiesState.pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < total - 1) items.push("ellipsis");
    items.push(total);
    return items;
  }, [tradiesState.pagination.page, tradiesState.pagination.totalPages]);

  const handleCategorySelect = (tradeType: string) => {
    dispatch(setTradieFilters({ tradeType }));
    setViewMode("table"); // Switch directly to table view filtered by this trade
  };

  const updateScheduleStatuses = async (ids: string[], status: TradieScheduleStatus) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map(async (id) => dispatch(updateTradieScheduleStatus({ scheduleId: id, status })).unwrap()));
    dispatch(clearSelectedSchedules());
  };

  const handleBulkConfirm = async () => {
    setBulkLoading("confirm");
    await updateScheduleStatuses(tradiesState.selectedScheduleIds, TradieScheduleStatus.CONFIRMED);
    setBulkLoading(null);
  };

  const handleBulkReminder = async () => {
    const valid = tableRowsSelected.filter((row) => row.status !== TradieScheduleStatus.CONFIRMED && row.status !== TradieScheduleStatus.COMPLETED);
    setBulkLoading("pending");
    await updateScheduleStatuses(valid.map((row) => row.id), TradieScheduleStatus.PENDING_RESPONSE);
    setBulkLoading(null);
  };

  const handleRowQuickConfirm = async (row: TradieScheduleListItem) => {
    const loading = toast.loading("Updating status...");
    try {
      await updateScheduleStatuses([row.id], TradieScheduleStatus.CONFIRMED);
      toast.success("Status updated to Confirmed", { id: loading });
    } catch (error) {
      toast.error("Failed to update status. Please try again.", { id: loading });
    } finally {
      toast.dismiss(loading);
    }
  };

  const handleUpdateRowStatus = (row: TradieScheduleListItem) => dispatch(openModal({ type: "confirmStatus", payload: { schedule: row } }));
  const handleRowReminder = async (row: TradieScheduleListItem) => dispatch(openModal({ type: "tradieReminder", payload: { schedule: row } }));
  const handleRowCallLogged = async (row: TradieScheduleListItem) => dispatch(openModal({ type: "logCall", payload: { schedule: row } }));

  const exportCsv = () => {
    const headers = ["Tradie", "Trade", "Project", "Task", "Scheduled", "Duration", "Status"];
    const rows = tradiesState.schedules.map((row) => [row.tradieName, row.tradeType, row.projectName, row.taskLabel, dateFormat.format(new Date(row.scheduledDate)), `${row.durationDays}`, statusLabelMap[row.status]]);
    const csv = [headers, ...rows].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tradie-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const renderScheduleActions = (row: TradieScheduleListItem, large = false) => {
    const size = large ? "icon" : "sm";
    const btn = large ? "h-10 w-10" : "";
    return (
      <div key={`actions-${row.id}`} className="flex justify-start gap-1" onClick={(event) => event.stopPropagation()}>
        {(row.status === TradieScheduleStatus.PENDING || row.status === TradieScheduleStatus.NO_RESPONSE || row.status === TradieScheduleStatus.PENDING_RESPONSE) && (
          <Button size={size} variant="ghost" className={btn} aria-label="Log call" onClick={() => void handleRowCallLogged(row)}>
            <Phone className="h-4 w-4" />
          </Button>
        )}
        {row.status !== TradieScheduleStatus.CONFIRMED && row.status !== TradieScheduleStatus.COMPLETED && (
          <Button size={size} variant="ghost" className={btn} aria-label="Mark confirmed" onClick={() => void handleRowQuickConfirm(row)}>
            <Check className="h-4 w-4" />
          </Button>
        )}
        {row.status !== TradieScheduleStatus.COMPLETED && (
          <Button size={size} variant="ghost" className={btn} aria-label="Send reminder" onClick={() => void handleRowReminder(row)}>
            <Mail className="h-4 w-4" />
          </Button>
        )}
        {row.status === TradieScheduleStatus.COMPLETED && (
          <Button size={size} variant="ghost" className={btn} disabled aria-label="Completed">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </Button>
        )}
        <Button size={size} variant="ghost" className={btn} aria-label="More actions" disabled={row.status === TradieScheduleStatus.COMPLETED} onClick={() => void handleUpdateRowStatus(row)}>
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const daysLeftBadgeClass = (scheduledDate: string) => ["rounded-md px-2 py-1 text-xs font-semibold flex gap-2 items-center", daysUntil(scheduledDate) <= 2 ? "bg-red-100 text-red-700" : daysUntil(scheduledDate) <= 7 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"].join(" ");

  const scheduleTableHeaders = [
    <input key="select-all" type="checkbox" checked={tradiesState.schedules.length > 0 && tradiesState.selectedScheduleIds.length === tradiesState.schedules.length} onChange={(event) => { if (event.target.checked) { dispatch(setSelectedSchedules(tradiesState.schedules.map((row) => row.id))); } else { dispatch(clearSelectedSchedules()); } }} />,
    "Tradie", "Trade", "Project", "Task", "Scheduled", "Days Left", "Status", "Actions",
  ];

  const scheduleTableRows = tradiesState.schedules.map((row) => [
    <input key={`select-${row.id}`} type="checkbox" checked={tradiesState.selectedScheduleIds.includes(row.id)} onChange={() => dispatch(toggleScheduleSelection(row.id))} onClick={(event) => event.stopPropagation()} />,
    <div key={`tradie-${row.id}`}>
      <p className="font-semibold text-slate-900">{row.tradieName}</p>
      <p className="text-xs text-muted-foreground">{row.abn}</p>
    </div>,
    <span key={`trade-${row.id}`} className={cn("px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md", getCategoryTheme(row.tradeType, 0).bg, getCategoryTheme(row.tradeType, 0).text)}>{row.tradeType}</span>,
    row.projectName,
    row.taskLabel,
    <div key={`schedule-${row.id}`}><p className="font-medium">{dateFormat.format(new Date(row.scheduledDate))}</p><p className="text-xs text-muted-foreground">{row.durationDays} day(s)</p></div>,
    <span key={`days-${row.id}`} className={daysLeftBadgeClass(row.scheduledDate)}>{CalanderRow(row.scheduledDate)}</span>,
    <StatusPill key={`status-${row.id}`} id={`status-${row.id}`} tone={statusToneMap[row.status]}>{statusLabelMap[row.status]}</StatusPill>,
    renderScheduleActions(row),
  ]);

  return (
    <div className="space-y-6 pb-12">
      {/* 1. TOP HEADER CARDS */}
      <Card className="overflow-hidden border-teal-100 bg-gradient-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
        <CardContent className="relative p-6">
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Tradie Management</h2>
              <p className="text-sm text-slate-600">Browse by trade category or switch views. Add, track incidents, update priority levels, and update pricing.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => dispatch(openModal({ type: "addTradie" }))}>
                <Plus className="mr-2 size-4" /> Add Tradie
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="mr-2 size-4" /> Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {tradiesState.summary && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard title="Registered Tradies" value={tradiesState.summary.registeredTradies} trendDelta={tradiesState.summary.registeredTrendDelta} Icon={Users} iconTone="bg-teal-600" />
          <MetricCard title="Incidents Logged" value={tradiesState.summary.inactiveTradies} Icon={AlertTriangle} iconTone="bg-red-500" />
          <MetricCard title="Favourites" value={tradiesState.summary.scheduledThisWeek} trendDelta={tradiesState.summary.scheduledWeekDelta} Icon={Star} iconTone="bg-orange-500" />
        </div>
      )}

      {tradiesState.summary?.inactiveTradies && (
        <div className="flex cursor-pointer items-center justify-between rounded-xl border border-red-200 bg-red-50 px-5 py-4 transition-colors hover:bg-red-100">
          <div className="flex items-center gap-4">
            <div className="grid size-10 place-items-center rounded-full bg-red-500 text-white"><TriangleAlert className="size-5" /></div>
            <div>
              <p className="text-sm font-bold text-red-800">{tradiesState.summary?.inactiveTradies} Unresolved Incidents</p>
              <p className="mt-0.5 text-xs text-red-600/80">Click to view flagged tradies in table view</p>
            </div>
          </div>
        </div>
      )}

      {/* 2. TOP FILTER BAR (Views, Search, Filters) */}
      <div className="flex flex-wrap items-center gap-3">
        {/* View Segmented Control */}
        <div className="flex p-1 rounded-lg bg-white border border-border/70 shadow-sm">
          <button onClick={() => setViewMode("categories")} className={cn("flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors", viewMode === "categories" ? "bg-teal-600 text-white shadow-sm" : "text-muted-foreground hover:bg-slate-100")}>
            <LayoutGrid className="w-4 h-4" /> Categories
          </button>
          <button onClick={() => setViewMode("list")} className={cn("flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors", viewMode === "list" ? "bg-teal-600 text-white shadow-sm" : "text-muted-foreground hover:bg-slate-100")}>
            <ListIcon className="w-4 h-4" /> List
          </button>
          <button onClick={() => setViewMode("table")} className={cn("flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors", viewMode === "table" ? "bg-teal-600 text-white shadow-sm" : "text-muted-foreground hover:bg-slate-100")}>
            <TableIcon className="w-4 h-4" /> Table
          </button>
        </div>

        {/* Global Search Input */}
        <div className="relative w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 rounded-lg border-border bg-white pl-9 text-[13px] shadow-sm" placeholder="Search tradies, projects, trades..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>

        {/* Dynamic Filters (Only show on List and Table views) */}
        {viewMode !== "categories" && (
          <>
            <Select value={tradiesState.filters.tradeType ?? "all"} onValueChange={(value) => dispatch(setTradieFilters({ tradeType: value === "all" ? null : value }))}>
              <SelectTrigger className="w-[140px] h-10 bg-white shadow-sm"><SelectValue placeholder="All Trades" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trades</SelectItem>
                {tradiesState.tradeOptions.map((trade) => (<SelectItem key={trade} value={trade}>{trade}</SelectItem>))}
              </SelectContent>
            </Select>

            <Select value={tradiesState.filters.status ?? "all"} onValueChange={(value) => dispatch(setTradieFilters({ status: value === "all" ? null : (value as TradieScheduleStatus) }))}>
              <SelectTrigger className="w-[140px] h-10 bg-white shadow-sm"><SelectValue placeholder="All Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(statusLabelMap).map(([status, label]) => (<SelectItem key={status} value={status}>{label}</SelectItem>))}
              </SelectContent>
            </Select>

            <div className="min-w-[180px] lg:max-w-[220px]">
              <SearchableSelect
                label="" placeholder="All Projects" searchValue={projectSearch} selectedItem={selectedProject} items={tradiesState.projectLookup.items}
                loading={tradiesState.projectLookup.loading || tradiesState.projectLookup.loadingMore}
                hasMore={tradiesState.projectLookup.page < tradiesState.projectLookup.totalPages}
                onQueryChange={setProjectSearch} onSelect={(item) => dispatch(setTradieFilters({ projectId: item.id }))} onClear={() => dispatch(setTradieFilters({ projectId: null }))}
                onLoadMore={() => void dispatch(fetchTradieProjectLookup({ page: tradiesState.projectLookup.page + 1, limit: tradiesState.projectLookup.limit, query: projectSearch }))}
              />
            </div>
          </>
        )}

        {/* Favorites Button */}
        <Button variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 hover:text-amber-800 h-10 shadow-sm ml-auto sm:ml-0">
          <Star className="w-4 h-4 mr-2 fill-amber-500 text-amber-500" /> Favorites
        </Button>
      </div>

      {/* 3. DYNAMIC VIEWS RENDERER */}

      {/* VIEW: CATEGORIES */}
      {viewMode === "categories" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4">
          {dynamicCategories.length === 0 ? (
            <div className="col-span-full rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No categories found.
            </div>
          ) : (
            dynamicCategories.map((cat) => {
              const isSelected = tradiesState.filters.tradeType === cat.name;
              return (
                <Card 
                  key={cat.name}
                  onClick={() => handleCategorySelect(cat.name)}
                  className={cn("relative cursor-pointer transition-all hover:shadow-md", isSelected ? "border-teal-500 ring-1 ring-teal-500 bg-teal-50/10" : "border-border/70 bg-white")}
                >
                  <div className="absolute top-3 right-3 bg-slate-100 text-slate-700 text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full">
                    {cat.jobs > 99 ? '99+' : cat.jobs}
                  </div>
                  <CardContent className="flex flex-col items-center justify-center p-6 text-center h-full gap-3">
                    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center", cat.bg, cat.text)}>
                      <cat.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{cat.name}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Click to view table</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* VIEW: LIST */}
      {viewMode === "list" && (
        <div className="space-y-3 mt-4">
          {dynamicCategories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No list items found.
            </div>
          ) : (
            dynamicCategories.map((cat) => (
              <div key={cat.name} onClick={() => handleCategorySelect(cat.name)} className="flex items-center justify-between p-4 bg-white border border-border/70 rounded-xl shadow-sm hover:border-teal-200 transition-colors cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", cat.bg, cat.text)}>
                    <cat.icon className="w-5 h-5" />
                  </div>
                  <span className="font-semibold text-slate-900">{cat.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center justify-center bg-slate-100 text-slate-700 text-xs font-bold w-6 h-6 rounded-full">
                    {cat.jobs > 99 ? '99+' : cat.jobs}
                  </span>
                  <ChevronDown className="w-5 h-5 text-muted-foreground group-hover:text-slate-900 -rotate-90" />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW: TABLE (With existing Data table) */}
      {viewMode === "table" && (
        <Card className="border-border/70 bg-white shadow-sm mt-4">
          <CardHeader className="border-b border-border/70 px-5 py-0 h-12 flex flex-row items-center justify-between">
            {/* The Semi Tabs requested applied to existing Status grouping */}
            <div className="flex items-center gap-4 h-full overflow-x-auto w-full">
              {(["all", "week", "confirmed", "pending", "overdue", "completed"] as const).map((tab) => {
                const active = tradiesState.filters.tab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => dispatch(setTradieFilters({ tab }))}
                    className={cn("relative flex items-center gap-2 text-sm font-semibold h-full px-1 whitespace-nowrap transition-colors", active ? "text-teal-800 border-b-2 border-teal-600" : "text-muted-foreground hover:text-foreground")}
                  >
                    {tab === "all" ? "All" : tab === "week" ? "Next 7 Days" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    <span className={cn("flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] rounded-full", active ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600")}>
                      {tradiesState.tabCounts[tab]}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="hidden md:block whitespace-nowrap text-[12px] font-medium text-muted-foreground">
              {tradiesState.pagination.totalCount} results
            </p>
          </CardHeader>

          <CardContent className="pt-4">
            {tradiesState.loading ? <LoadingSkeleton /> : null}

            {!tradiesState.loading && tradiesState.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{tradiesState.error}</div>
            ) : null}

            {!tradiesState.loading && !tradiesState.error && tradiesState.schedules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                No tradies match your current filters.
              </div>
            ) : null}

            {!tradiesState.loading && !tradiesState.error && tradiesState.schedules.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
                  <DataTable
                    headers={scheduleTableHeaders}
                    rows={scheduleTableRows}
                    onRowClick={(rowIndex) => {
                      const row = tradiesState.schedules[rowIndex];
                      dispatch(openModal({ type: "tradieScheduleDetails", payload: { schedule: row } }));
                    }}
                    emptyState={
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="flex size-12 items-center justify-center"><Clock10 className="size-5 text-muted-foreground" /></div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">No Tradie Schedule data available</p>
                          <p className="text-xs text-muted-foreground">Your Tradie Schedule details will appear here.</p>
                        </div>
                      </div>
                    }
                  />
                </div>

                {/* Mobile card fallback */}
                <div className="space-y-3 md:hidden">
                  {tradiesState.schedules.map((row) => (
                    <article
                      key={`card-${row.id}`} role="button" tabIndex={0}
                      onClick={() => dispatch(openModal({ type: "tradieScheduleDetails", payload: { schedule: row } }))}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dispatch(openModal({ type: "tradieScheduleDetails", payload: { schedule: row } })); } }}
                      className="cursor-pointer rounded-xl border border-border/70 bg-card p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input type="checkbox" className="mt-1 size-4" checked={tradiesState.selectedScheduleIds.includes(row.id)} onChange={() => dispatch(toggleScheduleSelection(row.id))} onClick={(event) => event.stopPropagation()} />
                          <div><p className="font-semibold text-slate-900">{row.tradieName}</p><p className="text-xs text-muted-foreground">{row.abn}</p></div>
                        </div>
                        <StatusPill id={`card-status-${row.id}`} tone={statusToneMap[row.status]}>{statusLabelMap[row.status]}</StatusPill>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Trade</dt><dd className="font-medium text-foreground">{row.tradeType}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Project</dt><dd className="font-medium text-foreground">{row.projectName}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Task</dt><dd className="font-medium text-foreground">{row.taskLabel}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Scheduled</dt><dd className="font-medium text-foreground">{dateFormat.format(new Date(row.scheduledDate))} <span className="text-xs text-muted-foreground">· {row.durationDays} day(s)</span></dd></div>
                      </dl>
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                        <span className={daysLeftBadgeClass(row.scheduledDate)}>{CalanderRow(row.scheduledDate)}</span>
                        {renderScheduleActions(row, true)}
                      </div>
                    </article>
                  ))}
                </div>

                {/* Bulk Actions */}
                {tradiesState.selectedScheduleIds.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
                    <span className="text-sm font-semibold text-teal-700">{tradiesState.selectedScheduleIds.length} selected</span>
                    <Button size="sm" onClick={() => void handleBulkReminder()} disabled={bulkLoading !== null}>{bulkLoading === "pending" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Send Reminders</Button>
                    <Button size="sm" variant="outline" onClick={() => void handleBulkConfirm()} disabled={bulkLoading !== null}>{bulkLoading === "confirm" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Mark Confirmed</Button>
                  </div>
                )}

                {/* Pagination */}
                {tradiesState.pagination.totalCount > 0 && (
                  <div className="space-y-2 pt-4">
                    <p className="text-center text-xs text-muted-foreground">Showing {tradiesState.schedules.length} of {tradiesState.pagination.totalCount} schedules</p>
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious href="#" onClick={(event) => { event.preventDefault(); dispatch(setTradiePage(Math.max(1, tradiesState.pagination.page - 1))); }} aria-disabled={tradiesState.pagination.page === 1} />
                        </PaginationItem>
                        {pageItems.map((item, index) => item === "ellipsis" ? (
                          <PaginationItem key={`ellipsis-${index}`}><PaginationEllipsis /></PaginationItem>
                        ) : (
                          <PaginationItem key={item}>
                            <PaginationLink href="#" isActive={item === tradiesState.pagination.page} onClick={(event) => { event.preventDefault(); dispatch(setTradiePage(item)); }}>{item}</PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext href="#" onClick={(event) => { event.preventDefault(); dispatch(setTradiePage(Math.min(tradiesState.pagination.totalPages, tradiesState.pagination.page + 1))); }} aria-disabled={tradiesState.pagination.page >= tradiesState.pagination.totalPages} />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}