'use client';
import React, { useState, useRef, useCallback, useMemo } from 'react';

export interface Record {
  id: number;
  title: string;
  artists: string[];
  genre: string;
  subgenre: string;
  cubby: number;
  order: number;
  on_my_wall: boolean;
  out_for_the_day: boolean;
  image_url?: string;
  discogs_id?: string | null;
}

interface CubbyWallProps {
  records: Record[];
  onToggleWall: (id: number) => void;
  onToggleOut: (id: number) => void;
  onCubbyChange: (recordId: number, newCubby: number, newOrder?: number) => Promise<void>;
  onRecordClick: (record: Record) => void;
}

interface CubbyGroup {
  cubbyNumber: number;
  records: Record[];
  startIdx: number;
  endIdx: number;
}

export const CubbyWall: React.FC<CubbyWallProps> = ({
  records,
  onToggleWall,
  onToggleOut,
  onCubbyChange,
  onRecordClick,
}) => {
  const [draggingSeparator, setDraggingSeparator] = useState<number | null>(null);
  const [dragRecord, setDragRecord] = useState<Record | null>(null);
  const [dragOffset, setDragOffset] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef<number>(0);

  // Group records by cubby and track their positions in the grid
  const cubbyGroups = useMemo(() => {
    const grouped = new Map<number, Record[]>();

    records.forEach((record) => {
      const cubby = record.cubby || 0;
      if (!grouped.has(cubby)) {
        grouped.set(cubby, []);
      }
      grouped.get(cubby)!.push(record);
    });

    const cubbies = Array.from(grouped.keys()).sort((a, b) => a - b);
    let startIdx = 0;

    return cubbies.map((cubby) => {
      const recordList = grouped.get(cubby) || [];
      // Sort by order within cubby
      recordList.sort((a, b) => (a.order || 0) - (b.order || 0));
      const numRecords = recordList.length;
      const endIdx = startIdx + numRecords - 1;
      const group: CubbyGroup = {
        cubbyNumber: cubby,
        records: recordList,
        startIdx,
        endIdx,
      };
      startIdx += numRecords;
      return group;
    });
  }, [records]);

  const handleSeparatorMouseDown = useCallback(
    (e: React.MouseEvent, groupIdx: number) => {
      setDraggingSeparator(groupIdx);
      dragStartXRef.current = e.clientX;
      setDragOffset(0);
      e.preventDefault();
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingSeparator === null) return;

      const deltaX = e.clientX - dragStartXRef.current;
      setDragOffset(deltaX);
    },
    [draggingSeparator]
  );

  const handleMouseUp = useCallback(async () => {
    if (draggingSeparator === null || dragOffset === 0) {
      setDraggingSeparator(null);
      setDragOffset(0);
      return;
    }

    const currentGroup = cubbyGroups[draggingSeparator];
    const nextGroup = cubbyGroups[draggingSeparator + 1];

    if (!currentGroup || !nextGroup) {
      setDraggingSeparator(null);
      setDragOffset(0);
      return;
    }

    // Determine action based on drag direction
    const direction = dragOffset > 0 ? 'right' : 'left';

    if (direction === 'left' && currentGroup.records.length > 0) {
      // Separator moves left: left cubby shrinks, its last record becomes first of right cubby
      const recordToMove = currentGroup.records[currentGroup.records.length - 1];
      const firstOfNext = nextGroup.records[0];
      // Place before all existing records in right cubby
      const newOrder = firstOfNext ? firstOfNext.order - 500 : recordToMove.order;
      try {
        await onCubbyChange(recordToMove.id, nextGroup.cubbyNumber, newOrder);
      } catch (err) {
        console.error('Failed to move record:', err);
      }
    } else if (direction === 'right' && nextGroup.records.length > 0) {
      // Separator moves right: right cubby shrinks, its first record becomes last of left cubby
      const recordToMove = nextGroup.records[0];
      const lastOfCurrent = currentGroup.records[currentGroup.records.length - 1];
      // Place after all existing records in left cubby
      const newOrder = lastOfCurrent ? lastOfCurrent.order + 500 : recordToMove.order;
      try {
        await onCubbyChange(recordToMove.id, currentGroup.cubbyNumber, newOrder);
      } catch (err) {
        console.error('Failed to move record:', err);
      }
    }

    setDraggingSeparator(null);
    setDragOffset(0);
  }, [draggingSeparator, dragOffset, cubbyGroups, onCubbyChange]);

  React.useEffect(() => {
    if (draggingSeparator !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingSeparator, handleMouseMove, handleMouseUp]);

  const handleRecordDragStart = (e: React.DragEvent, record: Record) => {
    setDragRecord(record);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(record.id));
  };

  const handleWallDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Flatten all records with separator information
  const recordsWithSeparators = useMemo(() => {
    const items: (Record | { type: 'separator'; groupIdx: number })[] = [];

    cubbyGroups.forEach((group, groupIdx) => {
      group.records.forEach((record) => {
        items.push(record);
      });

      // Add separator after each group except the last
      if (groupIdx < cubbyGroups.length - 1) {
        items.push({ type: 'separator', groupIdx });
      }
    });

    return items;
  }, [cubbyGroups]);

  return (
    <div className="w-full p-4">
      <div
        ref={containerRef}
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 w-full"
        onDragOver={handleWallDragOver}
      >
        {recordsWithSeparators.map((item, idx) => {
          if ('type' in item && item.type === 'separator') {
            const isBeingDragged = draggingSeparator === item.groupIdx;
            const direction = dragOffset > 0 ? 'right' : 'left';
            const shouldShowPreview = isBeingDragged && Math.abs(dragOffset) > 30;

            return (
              <div key={`sep-${item.groupIdx}`} className="col-span-1 relative flex items-center justify-center">
                {/* Ghost/Preview Separator */}
                {shouldShowPreview && (
                  <div
                    className="absolute h-full w-1.5 bg-red-400 opacity-70 transition-all rounded animate-pulse"
                    style={{
                      transform: `translateX(${dragOffset > 0 ? 30 : -30}px)`,
                    }}
                  />
                )}

                {/* Actual Separator */}
                <div
                  className={`h-full w-1 transition-all cursor-col-resize ${
                    isBeingDragged
                      ? 'bg-red-500 w-1.5'
                      : 'bg-gradient-to-b from-transparent via-zinc-600 to-transparent hover:via-red-500 hover:w-1.5'
                  }`}
                  style={{
                    transform: isBeingDragged ? `translateX(${dragOffset}px)` : 'translateX(0)',
                  }}
                  onMouseDown={(e) => handleSeparatorMouseDown(e, item.groupIdx)}
                  title={`Drag to move records between cubbies. Currently: ${dragOffset > 0 ? 'Move right' : dragOffset < 0 ? 'Move left' : 'Hold to preview'}`}
                />

                {/* Direction Indicator */}
                {shouldShowPreview && (
                  <div className="absolute -top-8 text-xs font-semibold text-red-300 pointer-events-none">
                    {direction === 'right' ? '→ Move right' : '← Move left'}
                  </div>
                )}
              </div>
            );
          }

          const record = item as Record;
          return (
            <div
              key={record.id}
              onDrop={(e) => {
                e.preventDefault();
                if (dragRecord && dragRecord.id !== record.id) {
                  onCubbyChange(dragRecord.id, record.cubby);
                }
              }}
            >
              <RecordTile
                record={record}
                onToggleWall={() => onToggleWall(record.id)}
                onToggleOut={() => onToggleOut(record.id)}
                onClick={() => onRecordClick(record)}
                onDragStart={(e) => handleRecordDragStart(e, record)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RecordTile: React.FC<{
  record: Record;
  onToggleWall: () => void;
  onToggleOut: () => void;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}> = ({ record, onToggleWall, onToggleOut, onClick, onDragStart }) => {
  const imageSrc = record.image_url
    ? `/api/cover-proxy?src=${encodeURIComponent(record.image_url)}${record.discogs_id ? `&id=${encodeURIComponent(record.discogs_id)}` : ''}`
    : null;

  const tags = [record.genre, record.subgenre]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .filter((value, idx, arr) => arr.findIndex((x) => x.toLowerCase() === value.toLowerCase()) === idx);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 p-2.5 flex flex-col items-center cursor-move hover:-translate-y-0.5 hover:border-red-400/40 hover:shadow-[0_14px_28px_rgba(0,0,0,0.35)] transition-all"
      onClick={onClick}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={record.title}
          className="w-full h-32 object-cover rounded-md mb-2 border border-zinc-800"
          onError={(e) => {
            const img = e.currentTarget;
            if (img.dataset.fallbackApplied === '1') return;
            img.dataset.fallbackApplied = '1';
            img.src = '/no-cover.svg';
          }}
          draggable={false}
        />
      ) : (
        <div className="w-full h-32 bg-zinc-900 rounded-md border border-zinc-800 mb-2 flex items-center justify-center text-xs text-zinc-500">
          No Image
        </div>
      )}
      <div className="font-semibold text-sm text-center line-clamp-2 mb-1 uppercase tracking-wide">{record.title}</div>
      <div className="text-xs text-zinc-400 mb-1 text-center line-clamp-2">
        {record.artists.join(', ')}
      </div>
      {tags.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap justify-center">
          {tags.map((tag) => (
            <span key={tag.toLowerCase()} className="text-xs bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 text-zinc-300">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 w-full justify-between">
        <button
          className={`text-xs px-2 py-1 rounded ${
            record.on_my_wall ? 'bg-emerald-500 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-300'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleWall();
          }}
        >
          Wall
        </button>
        <button
          className={`text-xs px-2 py-1 rounded ${
            record.out_for_the_day ? 'bg-red-500 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-300'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleOut();
          }}
        >
          Out
        </button>
      </div>
    </div>
  );
};
