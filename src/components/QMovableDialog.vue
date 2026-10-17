<script setup lang="ts">
import { computed, ref } from "vue";
import type { CSSProperties } from "vue";
import { QCard, useQuasar } from "quasar";

/**
 * 移動可能なダイアログの設定。
 */
interface Props {
  /** ダイアログのタイトル。 */
  title?: string;
  /** タイトルの左側に表示するアイコン名。 */
  titleIcon?: string;
  /** `footer`スロットを表示するかどうか。 */
  withFooter?: boolean;
  /** ダイアログ本体に適用するQuasarの色名。 */
  mainColor?: string;
  /** タイトルと閉じるボタンに適用するQuasarの色名。 */
  titleColor?: string;
  /** `true`の場合、閉じる要求時に自動で閉じず、親側の操作に委ねる。 */
  needActionBeforeClose?: boolean;
  /** 通常画面でのダイアログ幅。 */
  width?: string;
  /** 通常画面でのダイアログ最大幅。 */
  maxWidth?: string;
  /** ダイアログの最大高さ。 */
  maxHeight?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: "",
  titleIcon: undefined,
  withFooter: false,
  mainColor: "primary",
  titleColor: "white",
  needActionBeforeClose: false,
  width: "auto",
  maxWidth: "1443px",
  maxHeight: "calc(100dvh - 4rem)",
});

const emit = defineEmits<{
  /** 閉じるボタンが押されたときに発行する。 */
  (event: "close-request"): void;
  /** ダイアログが閉じ終わったときに発行する。 */
  (event: "closed"): void;
}>();

const q = useQuasar();

const visible = ref(false);
const cardRef = ref<InstanceType<typeof QCard> | null>(null);
const offset = ref({ x: 0, y: 0 });

const isSmallScreen = computed(() => q.screen.lt.md);

/** 画面サイズとドラッグ位置を反映したダイアログのスタイル。 */
const cardStyle = computed<CSSProperties>(() => ({
  width: isSmallScreen.value ? "calc(100vw - 1rem)" : props.width,
  maxWidth: isSmallScreen.value ? "calc(100vw - 1rem)" : props.maxWidth,
  maxHeight: props.maxHeight,
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
}));

/** ダイアログを初期位置に戻して表示する。 */
const show = () => {
  offset.value = { x: 0, y: 0 };
  visible.value = true;
};

/** ダイアログを閉じる。 */
const hide = () => {
  visible.value = false;
};

/**
 * 閉じる要求イベントを通知し、親による事前操作が不要な場合は閉じる。
 */
const requestClose = () => {
  emit("close-request");

  if (!props.needActionBeforeClose) {
    hide();
  }
};

/** ダイアログが閉じたときにドラッグ状態を解除して通知する。 */
const onDialogHide = () => {
  stopDrag();
  emit("closed");
};

/** ドラッグ開始時点のポインター位置とダイアログ位置。 */
interface DragState {
  /** ドラッグに使用しているポインターの識別子。 */
  pointerId: number;
  /** ドラッグ開始時のポインターのX座標。 */
  startX: number;
  /** ドラッグ開始時のポインターのY座標。 */
  startY: number;
  /** ドラッグ開始時のダイアログのX方向オフセット。 */
  originX: number;
  /** ドラッグ開始時のダイアログのY方向オフセット。 */
  originY: number;
}

let dragState: DragState | null = null;
let dragTarget: HTMLElement | null = null;

/** ポインターキャプチャを解放し、ドラッグ状態を初期化する。 */
const stopDrag = () => {
  if (dragTarget && dragState) {
    if (dragTarget.hasPointerCapture(dragState.pointerId)) {
      dragTarget.releasePointerCapture(dragState.pointerId);
    }
  }

  dragState = null;
  dragTarget = null;
};

/** ヘッダー上でのドラッグを開始する。 */
const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary) return;

  // ヘッダー内の操作ボタンからドラッグを開始しない。
  if ((event.target as HTMLElement).closest("button")) return;

  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;

  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: offset.value.x,
    originY: offset.value.y,
  };

  dragTarget = target;
  target.setPointerCapture(event.pointerId);
};

/** ポインターの移動量に応じてダイアログ位置を更新する。 */
const onPointerMove = (event: PointerEvent) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const card = cardRef.value?.$el as HTMLElement | undefined;
  if (!card) return;

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;

  const nextX = dragState.originX + dx;
  const nextY = dragState.originY + dy;

  const rect = card.getBoundingClientRect();
  const baseLeft = rect.left - offset.value.x;
  const baseTop = rect.top - offset.value.y;

  const margin = 100;

  // 横方向はカードの一部を画面内に残す。
  const minX = margin - card.offsetWidth - baseLeft;
  const maxX = window.innerWidth - margin - baseLeft;

  // 縦方向はヘッダー全体を画面内に残す。
  const headerHeight = dragTarget?.getBoundingClientRect().height ?? 40;

  const minY = -baseTop;
  const maxY = window.innerHeight - headerHeight - baseTop;

  offset.value = {
    x: Math.max(minX, Math.min(maxX, nextX)),
    y: Math.max(minY, Math.min(maxY, nextY)),
  };
};

/** ドラッグを終了し、ポインターキャプチャを解放する。 */
const onPointerUp = (event: PointerEvent) => {
  if (dragState?.pointerId !== event.pointerId) return;
  stopDrag();
};

/** 親コンポーネントから操作できるメソッドと表示状態。 */
defineExpose({
  /** ダイアログを表示する。 */
  show,
  /** ダイアログを閉じる。 */
  hide,
  /** ダイアログが表示中かどうか。 */
  visible,
});
</script>

<template>
  <q-dialog
    v-model="visible"
    class="movable-dialog"
    no-backdrop-dismiss
    no-esc-dismiss
    no-shake
    no-refocus
    @hide="onDialogHide"
  >
    <q-card ref="cardRef" class="movable-dialog-card" :style="cardStyle">
      <q-card-section
        class="movable-dialog-header"
        :class="[`bg-${mainColor}`, `text-${titleColor}`]"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @lostpointercapture="stopDrag"
      >
        <div class="movable-dialog-title">
          <q-icon v-if="titleIcon" :name="titleIcon" class="q-mr-sm" />
          <span>{{ title }}</span>
        </div>

        <q-btn
          flat
          round
          dense
          icon="close"
          tabindex="-1"
          :color="titleColor"
          @click="requestClose"
        />
      </q-card-section>

      <q-separator />

      <q-card-section class="movable-dialog-body">
        <slot />
      </q-card-section>

      <template v-if="withFooter">
        <q-separator />
        <q-card-actions align="right" class="movable-dialog-footer">
          <slot name="footer" />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.movable-dialog-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.movable-dialog-header {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 2.5rem;
  padding: 0.25rem 1rem;
  cursor: move;
  user-select: none;
  touch-action: none;
}

.movable-dialog-title {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 1rem;
  font-weight: 500;
}

.movable-dialog-title span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.movable-dialog-body {
  flex: 0 1 auto;
  min-height: 0;
  padding: 1rem;
  overflow-y: auto;
  scrollbar-width: thin;
}

.movable-dialog-footer {
  flex: 0 0 auto;
  min-height: 3.5rem;
  padding: 0.25rem 1rem;
}

.movable-dialog-footer :deep(button) {
  font-weight: bold;
}

@media (max-width: 599px) {
  .movable-dialog-body {
    padding: 0.75rem;
  }
}
</style>
