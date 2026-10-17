<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import { QTable } from "quasar";
import type { QTableProps } from "quasar";
import type { QTableSpreadsheetColumn } from "../types/QTableSpreadsheet";

interface Props {
  rows: Record<string, unknown>[];
  columns: QTableSpreadsheetColumn[];
  rowKey?: QTableProps["rowKey"];
}

const props = withDefaults(defineProps<Props>(), {
  rowKey: "id",
});

const emit = defineEmits<{
  (e: "resize-column", name: string, width: number): void;
}>();

const widths = ref<Record<string, number>>({});

const DUMMY_COLUMN_NAME = "__spreadsheet_dummy__";

const tableColumns = computed<QTableSpreadsheetColumn[]>(() => [
  ...props.columns.map((col) => {
    const width = widths.value[col.name] ?? col.width;

    const widthStyle =
      width != null
        ? `width: ${width}px; min-width: ${width}px; max-width: ${width}px`
        : "";

    return {
      ...col,
      style: [col.style, widthStyle].filter(Boolean).join(";"),
      headerStyle: [col.headerStyle, widthStyle].filter(Boolean).join(";"),
    };
  }),
  {
    name: DUMMY_COLUMN_NAME,
    label: "",
    field: () => "",
    align: "left",
    sortable: false,
    resizable: false,
    style: "width: auto",
    headerStyle: "width: auto",
    classes: "col--dummy",
    headerClasses: "col--dummy",
  },
]);
let resizing:
  | {
      name: string;
      startX: number;
      startWidth: number;
    }
  | undefined;

function stopResize() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function onPointerDown(event: PointerEvent, column: QTableSpreadsheetColumn) {
  if (column.resizable === false) return;

  event.preventDefault();
  event.stopPropagation();

  const th = (event.currentTarget as HTMLElement).closest("th");
  if (!th) return;

  resizing = {
    name: column.name,
    startX: event.clientX,
    startWidth: th.getBoundingClientRect().width,
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (!resizing) return;

  const width = Math.max(
    40,
    resizing.startWidth + event.clientX - resizing.startX,
  );

  widths.value[resizing.name] = width;
}

function onPointerUp() {
  if (resizing) {
    const width = widths.value[resizing.name];

    if (width !== undefined) {
      emit("resize-column", resizing.name, width);
    }
  }

  resizing = undefined;
  stopResize();
}

onUnmounted(stopResize);
</script>

<template>
  <QTable
    :rows="rows"
    :columns="tableColumns"
    :row-key="rowKey"
    separator="cell"
    flat
    bordered
  >
    <template #header="scope">
      <q-tr :props="scope">
        <q-th
          v-for="col in scope.cols"
          :key="col.name"
          :props="scope"
          :style="col.headerStyle"
          :class="['spreadsheet-header', col.headerClasses]"
        >
          <template v-if="col.name !== DUMMY_COLUMN_NAME">
            {{ col.label }}

            <div
              v-if="col.resizable !== false"
              class="column-resizer"
              @pointerdown="onPointerDown($event, col)"
              @click.stop
            />
          </template>
        </q-th>
      </q-tr>
    </template>
  </QTable>
</template>

<style scoped>
.spreadsheet-header {
  position: relative;
}

.column-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
:deep(.col--dummy) {
  width: auto;
  min-width: 0;
  max-width: none;
}
</style>
