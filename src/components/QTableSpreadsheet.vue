<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import type { CSSProperties } from "vue";
import { QTable } from "quasar";
import type { QTableProps } from "quasar";
import type { QTableSpreadsheetColumn } from "../types/QTableSpreadsheet";

/**
 * 表計算ソフト風の表示・操作に対応するテーブルの設定。
 */
interface Props {
  /** テーブルに表示する行データ。 */
  rows: Record<string, unknown>[];
  /** 表示列と、列ごとの絞り込み・幅調整などの設定。 */
  columns: QTableSpreadsheetColumn[];
  /** 行を識別するキー。 */
  rowKey?: QTableProps["rowKey"];
  /** 仮想スクロールで使用する行の高さ（ピクセル）。 */
  rowHeight?: number;
  /** テーブル本体の高さを表すCSS値。 */
  tableHeight?: string;
}

/** 現在の並べ替え方向。 */
type SortDirection = "asc" | "desc";

const props = withDefaults(defineProps<Props>(), {
  rowKey: "id",
  rowHeight: 24,
  tableHeight: "70vh",
});

const emit = defineEmits<{
  /** 列幅が変更されたときに列名と幅（ピクセル）を通知する。 */
  (event: "resize-column", name: string, width: number): void;
}>();

/** 行番号列に割り当てる内部列名。 */
const INDEX_COLUMN_NAME = "__row_index__";
/** 残りの領域を埋める内部列名。 */
const DUMMY_COLUMN_NAME = "__spreadsheet_dummy__";
const DEFAULT_COLUMN_MIN_WIDTH = 40;
const SORTABLE_COLUMN_MIN_WIDTH = 48;
const DEFAULT_COLUMN_WIDTH = 160;
const INDEX_COLUMN_WIDTH = 40;
const RESIZER_WIDTH = 8;
const CELL_HORIZONTAL_PADDING = 16;

const tableRef = ref<InstanceType<typeof QTable> | null>(null);
const headerHeight = ref(0);
const widths = ref<Record<string, number>>({});
const filterValues = reactive<Record<string, string | null>>({});
const sortColumnName = ref<string | null>(null);
const sortDirection = ref<SortDirection>("asc");
const tooltipTarget = ref<HTMLElement | null>(null);
const tooltipText = ref("");
const tooltipVisible = ref(false);

/** テーブルの行高、ヘッダー高、最小幅をCSS変数として渡す。 */
const tableStyle = computed<CSSProperties>(() => ({
  "--spreadsheet-row-height": `${props.rowHeight}px`,
  "--spreadsheet-header-height": `${headerHeight.value}px`,
  "--spreadsheet-table-min-width": `${tableMinWidth.value}px`,
}));

const filterColumns = computed(() =>
  props.columns.filter((column) => column.hasFilter === true),
);
const hasFilterRow = computed(() => filterColumns.value.length > 0);

/** 列設定とソート可否に基づく最小幅を返す。 */
const getColumnMinWidth = (column: QTableSpreadsheetColumn): number =>
  Math.max(
    column.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH,
    column.sortable === true
      ? SORTABLE_COLUMN_MIN_WIDTH
      : DEFAULT_COLUMN_MIN_WIDTH,
  );

/** 保存済み幅、列の初期幅、既定幅のうち適用可能な幅を返す。 */
const getColumnWidth = (column: QTableSpreadsheetColumn): number =>
  Math.max(
    widths.value[column.name] ?? column.width ?? DEFAULT_COLUMN_WIDTH,
    getColumnMinWidth(column),
  );

/** 指定列が並べ替え可能かを返す。 */
const isSortableColumn = (name: string): boolean =>
  props.columns.some(
    (column) => column.name === name && column.sortable === true,
  );

/** 指定名に一致する並べ替え可能な列設定を返す。 */
const getSortableColumn = (name: string): QTableSpreadsheetColumn | undefined =>
  props.columns.find(
    (column) => column.name === name && column.sortable === true,
  );

/**
 * 絞り込み比較用に文字列を正規化する。
 * 全角・半角、英字の大小文字、ひらがな・カタカナ、小さい仮名と通常の仮名を同一視する。
 */
const normalizeFilterText = (value: unknown): string => {
  const text = String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase();
  const hiragana = Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCharCode(code - 0x60)
      : character;
  }).join("");
  const smallKana = "ぁぃぅぇぉっゃゅょゎゕゖ";
  const normalKana = "あいうえおつやゆよわかけ";
  return hiragana.replace(/[ぁぃぅぇぉっゃゅょゎゕゖ]/g, (character) => {
    const index = smallKana.indexOf(character);
    return normalKana[index] ?? character;
  });
};

/**
 * 数値条件に値が一致するか判定する。
 * `100`、比較演算子付きの値、`100..500`の範囲を扱い、不正な条件は適用しない。
 * @param value 判定するセルの値。
 * @param filter 入力された数値条件。
 * @returns 条件に一致する場合は`true`。
 */
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
    return (
      Number.isFinite(numericValue) &&
      numericValue >= minimum &&
      numericValue <= maximum
    );
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
    case ">":
      return numericValue > target;
    case "<":
      return numericValue < target;
    case ">=":
      return numericValue >= target;
    case "<=":
      return numericValue <= target;
    default:
      return numericValue === target;
  }
};

/** 列の`field`設定を使って行データからセルの値を取得する。 */
const getColumnValue = (
  column: QTableSpreadsheetColumn,
  row: Record<string, unknown>,
): unknown => {
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

/** セルの値に列の書式関数を適用し、表示用文字列を返す。 */
const getDisplayText = (
  column: QTableSpreadsheetColumn,
  row: Record<string, unknown>,
): string => {
  const value = getColumnValue(column, row);
  return String(
    column.format ? (column.format(value, row) ?? "") : (value ?? ""),
  );
};

const sortCollator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});

/** 空値を判定し、それ以外を数値または日本語文字列として比較する。 */
const compareSortValues = (valueA: unknown, valueB: unknown): number => {
  const isEmptyA = valueA === null || valueA === undefined || valueA === "";
  const isEmptyB = valueB === null || valueB === undefined || valueB === "";
  if (isEmptyA && isEmptyB) return 0;
  if (isEmptyA) return 1;
  if (isEmptyB) return -1;
  if (typeof valueA === "number" && typeof valueB === "number") {
    return valueA - valueB;
  }
  return sortCollator.compare(String(valueA), String(valueB));
};

/** 列の並べ替えを昇順、降順、解除の順に切り替える。 */
const toggleSort = (columnName: string) => {
  if (!isSortableColumn(columnName)) return;
  if (sortColumnName.value !== columnName) {
    sortColumnName.value = columnName;
    sortDirection.value = "asc";
    return;
  }
  if (sortDirection.value === "asc") {
    sortDirection.value = "desc";
    return;
  }
  sortColumnName.value = null;
  sortDirection.value = "asc";
};

/**
 * 絞り込みと並べ替えを適用した表示行を生成し、表示順の行番号を付与する。
 * 元の`props.rows`は変更せず、同値行は元配列内の順序を保つ。
 */
const tableRows = computed(() => {
  let rows = [...props.rows];

  // 絞り込みを先に適用する。
  rows = rows.filter((row) => {
    for (const column of filterColumns.value) {
      const filter = (filterValues[column.name] ?? "").trim();
      if (!filter) continue;
      const value = getColumnValue(column, row);
      if (column.filterType === "number") {
        if (!matchesNumberFilter(value, filter)) return false;
        continue;
      }
      if (
        !normalizeFilterText(getDisplayText(column, row)).includes(
          normalizeFilterText(filter),
        )
      )
        return false;
    }
    return true;
  });

  // 毎回元配列のコピーから始め、同一値間の順序を元配列に保つ。
  const sortColumn =
    sortColumnName.value !== null
      ? getSortableColumn(sortColumnName.value)
      : undefined;
  if (sortColumn) {
    const direction = sortDirection.value === "asc" ? 1 : -1;
    rows.sort(
      (rowA, rowB) =>
        compareSortValues(
          getColumnValue(sortColumn, rowA),
          getColumnValue(sortColumn, rowB),
        ) * direction,
    );
  }

  // 絞り込み・並べ替え後の表示順で行番号を付与する。
  return rows.map((row, index) => ({ ...row, row_index: index + 1 }));
});

/** 行番号に応じて偶数行用の背景クラスを返す。 */
const tableRowClassFn = (row: Record<string, unknown>) =>
  Number(row.row_index) % 2 === 0 ? "spreadsheet-row-even" : "";

/**
 * 行番号列・データ列・余白列を含むQTable用の列定義を生成する。
 * 列幅を内容の長さから独立させるため、QTable標準の並べ替えは無効にする。
 */
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
  ...props.columns.map((column) => ({
    ...column,
    sortable: false,
  })),
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

/** 列名に対応するセル幅のインラインスタイルを返す。 */
const getCellWidthStyle = (name: string): CSSProperties => {
  if (name === INDEX_COLUMN_NAME) return { width: `${INDEX_COLUMN_WIDTH}px` };
  if (name === DUMMY_COLUMN_NAME) return {};
  const column = props.columns.find((item) => item.name === name);
  return column ? { width: `${getColumnWidth(column)}px` } : {};
};

/** 行番号列と各データ列の幅を合計したテーブルの最小幅。 */
const tableMinWidth = computed(
  () =>
    INDEX_COLUMN_WIDTH +
    props.columns.reduce((total, column) => total + getColumnWidth(column), 0),
);

/** ホバー対象の文字列が切り詰められている場合にツールチップを表示する。 */
const showTooltipIfTruncated = (event: MouseEvent) => {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  if (target.scrollWidth <= target.clientWidth) return;
  tooltipTarget.value = target;
  tooltipText.value = target.textContent?.trim() ?? "";
  tooltipVisible.value = tooltipText.value.length > 0;
};

/** 表示中のツールチップを隠す。 */
const hideTooltip = () => {
  tooltipVisible.value = false;
};

/** ヘッダーの実測高さを監視するためのオブザーバー。 */
let headerResizeObserver: ResizeObserver | undefined;
/** ヘッダー行の高さを計測し、フィルター行の固定位置に反映する。 */
const observeHeaderHeight = () => {
  headerResizeObserver?.disconnect();
  headerResizeObserver = undefined;
  const tableElement = tableRef.value?.$el as HTMLElement | undefined;
  const headerRow = tableElement?.querySelector(
    ".q-table thead tr:first-child",
  );
  if (!headerRow) return;
  const updateHeaderHeight = () => {
    headerHeight.value = headerRow.getBoundingClientRect().height;
  };
  updateHeaderHeight();
  headerResizeObserver = new ResizeObserver(updateHeaderHeight);
  headerResizeObserver.observe(headerRow);
};

/** 初回描画後にヘッダー行の高さを計測する。 */
onMounted(() => {
  nextTick(observeHeaderHeight);
});

watch(
  () => props.columns,
  async () => {
    await nextTick();
    observeHeaderHeight();
  },
);

let resizing: { name: string; startX: number; startWidth: number } | undefined;

/** 列内の最大文字幅を計測して列幅を調整し、変更を通知する。 */
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
    maxWidth = Math.max(
      maxWidth,
      context.measureText(getDisplayText(column, row)).width,
    );
  }
  const width = Math.max(
    getColumnMinWidth(column),
    Math.ceil(
      maxWidth +
        CELL_HORIZONTAL_PADDING +
        RESIZER_WIDTH +
        (column.sortable === true ? 16 : 0),
    ),
  );
  widths.value[column.name] = width;
  emit("resize-column", column.name, width);
};

/** ポインターの移動量に合わせて調整中の列幅を更新する。 */
const onPointerMove = (event: PointerEvent) => {
  if (!resizing) return;
  const column = props.columns.find((item) => item.name === resizing?.name);
  const width = Math.max(
    column ? getColumnMinWidth(column) : DEFAULT_COLUMN_MIN_WIDTH,
    resizing.startWidth + event.clientX - resizing.startX,
  );
  widths.value[resizing.name] = width;
};

/** 列幅調整に使用するウィンドウイベントリスナーを解除する。 */
const stopResize = () => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
};

/** 列幅調整を確定し、最終幅を通知してイベントリスナーを解除する。 */
const onPointerUp = () => {
  if (resizing) {
    const width = widths.value[resizing.name];
    if (width !== undefined) emit("resize-column", resizing.name, width);
  }
  resizing = undefined;
  stopResize();
};

/** リサイズハンドル上のポインター操作を受けて列幅調整を開始する。 */
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

/** コンポーネント破棄時に監視とイベントリスナーを解放する。 */
onUnmounted(() => {
  headerResizeObserver?.disconnect();
  stopResize();
});
</script>

<template>
  <QTable
    ref="tableRef"
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
      <q-tr :props="scope">
        <q-th
          v-for="column in scope.cols"
          :key="column.name"
          :props="scope"
          :style="getCellWidthStyle(column.name)"
          :class="[
            'spreadsheet-header',
            column.headerClasses,
            { 'spreadsheet-sortable': isSortableColumn(column.name) },
          ]"
          @click="toggleSort(column.name)"
        >
          <template
            v-if="
              column.name !== DUMMY_COLUMN_NAME &&
              column.name !== INDEX_COLUMN_NAME
            "
          >
            <span
              class="spreadsheet-header-content"
              :class="{
                'spreadsheet-header-content--sortable': isSortableColumn(
                  column.name,
                ),
              }"
            >
              <span
                class="spreadsheet-header-label"
                @mouseenter="showTooltipIfTruncated"
                @mouseleave="hideTooltip"
              >
                {{ column.label }}
              </span>
              <q-icon
                v-if="sortColumnName === column.name"
                class="spreadsheet-sort-icon"
                :name="
                  sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'
                "
                size="14px"
              />
            </span>
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

      <q-tr v-if="hasFilterRow" :props="scope" class="spreadsheet-filter-row">
        <q-th
          v-for="column in scope.cols"
          :key="column.name"
          :props="scope"
          :class="column.headerClasses"
          :style="getCellWidthStyle(column.name)"
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

    <template #body="scope">
      <q-tr :props="scope" :class="tableRowClassFn(scope.row)">
        <q-td
          v-for="column in scope.cols"
          :key="column.name"
          :props="scope"
          :class="column.classes"
          :style="getCellWidthStyle(column.name)"
        >
          <template v-if="column.name === INDEX_COLUMN_NAME">
            {{ scope.row.row_index }}
          </template>
          <template v-else-if="column.name !== DUMMY_COLUMN_NAME">
            <span
              class="spreadsheet-cell-text"
              @mouseenter="showTooltipIfTruncated"
              @mouseleave="hideTooltip"
            >
              {{ getDisplayText(column, scope.row) }}
            </span>
          </template>
        </q-td>
      </q-tr>
    </template>
  </QTable>
  <q-tooltip
    v-model="tooltipVisible"
    :target="tooltipTarget ?? false"
    anchor="bottom middle"
    self="top middle"
    :offset="[0, 6]"
    >{{ tooltipText }}</q-tooltip
  >
</template>

<style scoped>
.q-table-spreadsheet {
  font-size: var(--spreadsheet-font-size, 0.75rem);
  color: var(--spreadsheet-text-color, #212121);
  background-color: var(--spreadsheet-row-bg, #fff);
}

.q-table-spreadsheet :deep(.q-table) {
  table-layout: fixed;
  width: 100%;
  min-width: var(--spreadsheet-table-min-width);
}

.q-table-spreadsheet :deep(.q-table tbody tr),
.q-table-spreadsheet :deep(.q-table tbody td) {
  height: var(--spreadsheet-row-height, 24px);
}

.q-table-spreadsheet :deep(.q-table tbody td) {
  box-sizing: border-box;
  padding-top: 0;
  padding-bottom: 0;
  font-size: inherit;
  color: inherit;
  overflow: hidden;
}

.q-table-spreadsheet :deep(.spreadsheet-row-even > td) {
  background-color: var(--spreadsheet-row-even-bg, #f3f6f8);
}

.spreadsheet-header {
  text-align: center !important;
  background-color: var(--spreadsheet-header-bg, #455a64);
  color: var(--spreadsheet-header-color, #fff);
  border-color: var(--spreadsheet-border-color, #b0bec5);
  overflow: hidden;
}

.spreadsheet-header-content {
  display: block;
  position: relative;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding-right: 8px;
}

.spreadsheet-header-content--sortable {
  padding-right: 24px;
}

.spreadsheet-header-label,
.spreadsheet-cell-text {
  display: block;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spreadsheet-sort-icon {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}

.spreadsheet-sortable {
  cursor: pointer;
}

.q-table-spreadsheet :deep(thead tr:first-child th) {
  position: sticky;
  top: 0;
  z-index: 4;
}

.spreadsheet-filter-row :deep(th) {
  padding: 2px 4px;
  background-color: var(--spreadsheet-row-bg, #fff);
  overflow: hidden;
}

.spreadsheet-filter-row :deep(.q-field--dense .q-field__control),
.spreadsheet-filter-row :deep(.q-field--dense .q-field__marginal) {
  height: 28px;
}

.q-table-spreadsheet :deep(thead tr.spreadsheet-filter-row th) {
  position: sticky;
  top: var(--spreadsheet-header-height);
  z-index: 4;
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
  z-index: 5;
}

.q-table-spreadsheet :deep(.col--dummy) {
  width: auto;
  min-width: 0;
  max-width: none;
}
</style>
