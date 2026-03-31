import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import type { LatestEvent } from '~/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type EventsTableProps = {
  events: LatestEvent[];
};

export function EventsTable({ events }: EventsTableProps) {
  const columns = useMemo<ColumnDef<LatestEvent>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Created At',
        cell: ({ getValue }) => {
          const raw = getValue<string>();
          return new Date(raw).toLocaleTimeString();
        },
      },
      {
        accessorKey: 'user_id',
        header: 'User ID',
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'event_type',
        header: 'Event',
      },
      {
        accessorKey: 'processed_by',
        header: 'Processed By',
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'kafka_partition',
        header: 'Partition',
        cell: ({ getValue }) => {
          const partition = getValue<number>();
          return <span className="font-mono text-xs">p{partition}</span>;
        },
      },
      {
        id: 'path',
        header: 'Path',
        cell: ({ row }) => {
          const path = row.original.payload.path;
          return typeof path === 'string' ? path : '-';
        },
      },
      {
        id: 'device',
        header: 'Device',
        cell: ({ row }) => {
          const device = row.original.payload.device;
          return typeof device === 'string' ? device : '-';
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: events,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card className="animate-floatIn [animation-delay:140ms]">
      <CardHeader>
        <CardTitle>Latest 100 Events</CardTitle>
      </CardHeader>

      <CardContent>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={columns.length}>
                  Waiting for events...
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
