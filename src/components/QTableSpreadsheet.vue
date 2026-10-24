<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import type { CSSProperties } from "vue";
import { QTable } from "quasar";
import type { QTableProps } from "quasar";
import type { QTableSpreadsheetColumn } from "../types/QTableSpreadsheet";

interface Props {
  rows: Record<string, unknown>[];
  columns: QTableSpreadsheetColumn[];
  rowKey?: QTableProps["rowKey"];
  rowHeight?: number;
  tableHeight?: string;
}

const props = withDefaults(defineProps<Props>(), {
  rowKey: "id",
  rowHeight: 24,
  tableHeight: "70vh",
});

const emit = defineEmits<{
  (event: "resize-column", name: string, width: number): void;
}>();

const INDEX_COLUMN_NAME = "__row_index__";
const DUMMY_COLUMN_NAME = "__spreadsheet_dummy__";

const widths = ref<Record<string, number>>({});
const filterValues = reactive<Record<string, string | null>>({});

const tableStyle = computed<CSSProperties>(() => ({
  "--spreadsheet-row-height": `${props.rowHeight}px`,
}));

const filterColumns = computed(() =>
  props.columns.filter((column) => column.hasFilter === true),
);

const hasFilterRow = computed(() => filterColumns.value.length > 0);

// 検索時の表記揺れを吸収する。
// NFKCで全角・半角を統一し、カタカナをひらがなへ変換する。
// 小さい仮名も通常の仮名と同一視する。
const normalizeFilterText = (value: unknown): string => {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase();

  const hiragana = Array.from(text, (character) => {
    const code = character.charCodeAt(0);

    if (code >= 0x30a1 && code <= 0x30f6) {
      return String.fromCharCode(code - 0x60);
    }

    return character;
  }).join("");

  return hiragana.replace(/[ぁぃぅぇぉっゃゅょゎゕゖ]/g, (character) => {
    const smallKana = "ぁぃぅぇぉっゃゅょゎゕゖ";
    const normalKana = "あいうえおつやゆよわかけ";
    const index = smallKana.indexOf(character);

    return normalKana[index] ?? character;
  });
};

// 数値フィルタ。
// 数値、比較演算子、範囲指定（100..500）に対応する。
// 不正な入力は条件を適用しない。
const matchesNumberFilter = (value: unknown, filter: string): boolean => {
  const condition = filter.normalize("NFKC").trim();
  if (!condition) return true;

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  const numberPattern = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;

  const rangePattern = new RegExp(
    `^(${numberPattern})\\s*\\.\\.\\s*(${numberPattern})$`,
  );

  const rangeMatch = condition.match(rangePattern);

  if (rangeMatch) {
    const minimum = Number(rangeMatch[1]);
    const maximum = Number(rangeMatch[2]);

    if (!Number.isFinite(numericValue)) return false;

    return numericValue >= minimum && numericValue <= maximum;
  }

  const comparisonPattern = new RegExp(
    `^(>=|<=|>|<|=)?\\s*(${numberPattern})$`,
  );

  const comparisonMatch = condition.match(comparisonPattern);

  if (!comparisonMatch) return true;

  if (!Number.isFinite(numericValue)) return false;

  const operator = comparisonMatch[1] ?? "=";
  const target = Number(comparisonMatch[2]);

  switch (operator) {
    case ">=":
      return numericValue >= target;
    case "<=":
      return numericValue <= target;
    case ">":
      return numericValue > target;
    case "<":
      return numericValue < target;
    default:
      return numericValue === target;
  }
};

const getColumnValue = (
  column: QTableSpreadsheetColumn,
  row: Record<string, unknown>,
) => {
  const field = column.field;

  if (field === undefined) return undefined;
  if (typeof field === "function") return field(row);

  return field
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value != null && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row,
    );
};

const tableRows = computed(() => {
  let rows = [...props.rows];

  // 1. フィルタリング
  rows = rows.filter((row) => {
    for (const column of filterColumns.value) {
      const filter = (filterValues[column.name] ?? "").trim();

      if (!filter) continue;

      const value = getColumnValue(column, row);

      if (column.filterType === "number") {
        if (!matchesNumberFilter(value, filter)) {
          return false;
        }

        continue;
      }

      const displayValue = column.format ? column.format(value, row) : value;

      if (
        !normalizeFilterText(displayValue).includes(normalizeFilterText(filter))
      ) {
        return false;
      }
    }

    return true;
  });

  // 2. ソート（今後実装）

  // 3. 表示順に行番号を付与
  return rows.map((row, index) => ({
    ...row,
    row_index: index + 1,
  }));
});

const tableRowClassFn = (row: Record<string, unknown>) =>
  Number(row.row_index) % 2 === 0 ? "spreadsheet-row-even" : "";

const tableColumns = computed<QTableSpreadsheetColumn[]>(() => [
  {
    name: INDEX_COLUMN_NAME,
    label: "",
    field: "row_index",
    align: "right",
    sortable: false,
    resizable: false,
    classes: "col--index",
    headerClasses: "col--index",
  },
  ...props.columns.map((column) => {
    const width = widths.value[column.name] ?? column.width;

    const widthStyle =
      width != null
        ? `width: ${width}px; min-width: ${width}px; max-width: ${width}px`
        : "";

    return {
      ...column,
      sortable: false,
      style: [column.style, widthStyle].filter(Boolean).join(";"),
      headerStyle: [column.headerStyle, widthStyle].filter(Boolean).join(";"),
    };
  }),
  {
    name: DUMMY_COLUMN_NAME,
    label: "",
    field: () => "",
    align: "left",
    sortable: false,
    resizable: false,
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

const autoFitColumn = (event: MouseEvent, column: QTableSpreadsheetColumn) => {
  const th = (event.currentTarget as HTMLElement).closest("th");
  if (!th) return;

  const table = th.closest("table");
  if (!table) return;

  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;

  const headerFont = getComputedStyle(th).font;
  const bodyCell = table.querySelector("tbody td");
  const bodyFont = bodyCell ? getComputedStyle(bodyCell).font : headerFont;

  context.font = headerFont;
  let maxWidth = context.measureText(column.label).width;

  context.font = bodyFont;

  for (const row of tableRows.value) {
    const value = getColumnValue(column, row);
    const text = String(
      column.format ? column.format(value, row) : (value ?? ""),
    );

    maxWidth = Math.max(maxWidth, context.measureText(text).width);
  }

  const width = Math.max(column.minWidth ?? 40, Math.ceil(maxWidth + 24));

  widths.value[column.name] = width;
  emit("resize-column", column.name, width);
};

const onPointerMove = (event: PointerEvent) => {
  if (!resizing) return;

  const column = props.columns.find((item) => item.name === resizing?.name);

  const width = Math.max(
    column?.minWidth ?? 40,
    resizing.startWidth + event.clientX - resizing.startX,
  );

  widths.value[resizing.name] = width;
};

const stopResize = () => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
};

const onPointerUp = () => {
  if (resizing) {
    const width = widths.value[resizing.name];

    if (width !== undefined) {
      emit("resize-column", resizing.name, width);
    }
  }

  resizing = undefined;
  stopResize();
};

const onPointerDown = (
  event: PointerEvent,
  column: QTableSpreadsheetColumn,
) => {
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
};

onUnmounted(stopResize);
</script>

<template>
  <QTable
    class="q-table-spreadsheet"
    :rows="tableRows"
    :columns="tableColumns"
    :row-key="rowKey"
    :style="tableStyle"
    :table-style="{ height: tableHeight }"
    :table-row-class-fn="tableRowClassFn"
    :virtual-scroll-item-size="rowHeight"
    :rows-per-page-options="[0]"
    virtual-scroll
    hide-bottom
    dense
    separator="cell"
    flat
    bordered
  >
    <template #header="scope">
      <!-- ヘッダ行 -->
      <q-tr :props="scope">
        <q-th
          v-for="column in scope.cols"
          :key="column.name"
          :props="scope"
          :style="column.headerStyle"
          :class="['spreadsheet-header', column.headerClasses]"
        >
          <template v-if="column.name !== DUMMY_COLUMN_NAME">
            {{ column.label }}

            <div
              v-if="column.resizable !== false"
              class="column-resizer"
              @pointerdown="onPointerDown($event, column)"
              @dblclick.stop="autoFitColumn($event, column)"
              @click.stop
            />
          </template>
        </q-th>
      </q-tr>

      <!-- フィルタ行 -->
      <q-tr v-if="hasFilterRow" :props="scope" class="spreadsheet-filter-row">
        <q-th
          v-for="column in scope.cols"
          :key="column.name"
          :props="scope"
          :style="column.headerStyle"
          :class="column.headerClasses"
        >
          <q-input
            v-if="column.hasFilter"
            v-model="filterValues[column.name]"
            outlined
            dense
            clearable
          />
        </q-th>
      </q-tr>
    </template>

    <!-- 行番号 -->
    <template #body-cell-__row_index__="scope">
      <q-td :props="scope" class="col--index">
        {{ scope.row.row_index }}
      </q-td>
    </template>
  </QTable>
</template>

<style scoped>
.q-table-spreadsheet {
  font-size: var(--spreadsheet-font-size, 0.75rem);
  color: var(--spreadsheet-text-color, #212121);
  background-color: var(--spreadsheet-row-bg, #fff);
}

.q-table-spreadsheet :deep(.q-table tbody tr) {
  height: var(--spreadsheet-row-height, 24px);
}

.q-table-spreadsheet :deep(.q-table tbody td) {
  height: var(--spreadsheet-row-height, 24px);
  box-sizing: border-box;
  padding-top: 0;
  padding-bottom: 0;
  font-size: inherit;
  color: inherit;
}

.q-table-spreadsheet :deep(.spreadsheet-row-even > td) {
  background-color: var(--spreadsheet-row-even-bg, #f3f6f8);
}

.spreadsheet-header {
  position: relative;
  text-align: center !important;
  background-color: var(--spreadsheet-header-bg, #455a64);
  color: var(--spreadsheet-header-color, #fff);
  border-color: var(--spreadsheet-border-color, #b0bec5);
}

.spreadsheet-filter-row :deep(th) {
  padding: 2px 4px;
}
.spreadsheet-filter-row :deep(.q-field--dense .q-field__control),
.spreadsheet-filter-row :deep(.q-field--dense .q-field__marginal) {
  height: 28px;
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
  border-right: 2px solid var(--spreadsheet-resizer-color, #90a4ae);
}

.column-resizer:hover {
  background-color: var(
    --spreadsheet-resizer-hover-bg,
    rgba(255, 235, 59, 0.35)
  );
  border-right-color: var(--spreadsheet-resizer-hover-color, #ffeb3b);
}

.q-table-spreadsheet :deep(.q-table th.col--index),
.q-table-spreadsheet :deep(.q-table td.col--index) {
  position: sticky;
  left: 0;
  width: 2.5rem;
  min-width: 2.5rem;
  max-width: 2.5rem;
  box-sizing: border-box;
  text-align: right;
  padding-right: 0.75rem;
  z-index: 2;
}

.q-table-spreadsheet :deep(.q-table thead th.col--index) {
  z-index: 3;
}

.q-table-spreadsheet :deep(.col--dummy) {
  width: auto;
  min-width: 0;
  max-width: none;
}

/* ヘッダ行を最上部に固定 */
.q-table-spreadsheet :deep(.q-table thead tr:first-child th) {
  position: sticky;
  top: 0;
  z-index: 4;
}

/* フィルタ行をヘッダの直下に固定 */
.q-table-spreadsheet :deep(.q-table thead tr:nth-child(2) th) {
  position: sticky;
  top: 24px;
  z-index: 4;
}

.q-table-spreadsheet :deep(.spreadsheet-filter-row th) {
  background-color: var(--spreadsheet-row-bg, #fff);
}
</style>
