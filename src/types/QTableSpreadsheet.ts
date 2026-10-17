import type { QTableColumn } from "quasar";

export type QTableSpreadsheetColumn<
  Row extends Record<string, any> = Record<string, any>,
> = QTableColumn<Row> & {
  width?: number;
  minWidth?: number;
  hasFilter?: boolean;
  resizable?: boolean;
};
