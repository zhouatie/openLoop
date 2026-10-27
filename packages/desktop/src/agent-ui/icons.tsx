import React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

/* 图标路径取自 DSH 的 ui-primitives 图标源，保持 16 号栅格与 1.3px 描边 */
function createIcon(name: string, defaultSize: number, render: () => React.ReactNode) {
  const Icon = React.memo(function Icon({ size = defaultSize, className }: IconProps) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        strokeWidth={1.3}
        aria-hidden="true"
        focusable="false"
      >
        {render()}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon;
}

export const IconNewChat = createIcon('IconNewChat', 16, () => (
  <>
    <path
      d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337"
      stroke="currentColor"
    />
    <path d="M8 5V11" stroke="currentColor" />
    <path d="M5 8H11" stroke="currentColor" />
  </>
));

export const IconSearch = createIcon('IconSearch', 16, () => (
  <>
    <path
      d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z"
      stroke="currentColor"
    />
    <path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor" />
  </>
));

export const IconSort = createIcon('IconSort', 16, () => (
  <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5.1 6 2.9-2.9L10.9 6" />
    <path d="m5.1 10 2.9 2.9 2.9-2.9" />
  </g>
));

export const IconProjectAdd = createIcon('IconProjectAdd', 16, () => (
  <>
    <path
      d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z"
      fill="currentColor"
    />
    <path d="M9.75977 4.50208H14.5509" stroke="currentColor" />
    <path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor" />
  </>
));

export const IconFolderClose = createIcon('IconFolderClose', 16, () => (
  <>
    <path
      d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z"
      stroke="currentColor"
    />
    <path d="M3.63501 7.66614H12.3647" stroke="currentColor" />
  </>
));

export const IconFolderOpen = createIcon('IconFolderOpen', 16, () => (
  <>
    <path
      d="M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z"
      fill="currentColor"
      opacity="0.16"
    />
    <path
      d="M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491Z"
      fill="currentColor"
    />
    <path
      d="M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.735 6.69436 13.6494 6.69434 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z"
      fill="currentColor"
    />
  </>
));

export const IconTriangleRight = createIcon('IconTriangleRight', 14, () => (
  <path
    d="M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z"
    fill="currentColor"
  />
));

export const IconChevronDown = createIcon('IconChevronDown', 14, () => (
  <path
    d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const IconPlus = createIcon('IconPlus', 16, () => (
  <>
    <path d="M8 2V14" stroke="currentColor" />
    <path d="M2 8H14" stroke="currentColor" />
  </>
));

export const IconMore = createIcon('IconMore', 16, () => (
  <>
    <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
  </>
));

export const IconClose = createIcon('IconClose', 16, () => (
  <>
    <path d="M2.5 2.5L13.5 13.5" stroke="currentColor" />
    <path d="M13.5 2.5L2.5 13.5" stroke="currentColor" />
  </>
));

/* 发送箭头：DSH InputBar 主按钮的实心箭头（16 栅格，y 1 → 15） */
export const IconSend = createIcon('IconSend', 16, () => (
  <path
    d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
    fill="currentColor"
  />
));

/* 停止方块：与 DSH 同一矩形（10x10，圆角 3，居中于 16 栅格） */
export const IconStop = createIcon('IconStop', 16, () => (
  <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
));

export const IconFile = createIcon('IconFile', 16, () => (
  <path
    d="M3.5 2.5h5.2l3.8 3.8v7.2a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5Z"
    stroke="currentColor"
  />
));

export const IconMinimize = createIcon('IconMinimize', 16, () => (
  <path d="M3.5 8h9" stroke="currentColor" />
));

/** 右侧工作台面板图标：方框 + 右侧分栏 */
export const IconPanelRight = createIcon('IconPanelRight', 16, () => (
  <>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="2.2" stroke="currentColor" />
    <path d="M9.8 3.9v8.2" stroke="currentColor" />
  </>
));

/** 复制 */
export const IconCopy = createIcon('IconCopy', 16, () => (
  <>
    <rect x="5.5" y="5.5" width="8" height="8.5" rx="1.8" stroke="currentColor" />
    <path d="M10.5 5.2V4.1A1.6 1.6 0 0 0 8.9 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v4.8a1.6 1.6 0 0 0 1.6 1.6h1.1" stroke="currentColor" />
  </>
));

/** 赞 */
export const IconThumbUp = createIcon('IconThumbUp', 16, () => (
  <path
    d="M5.2 13.5V6.9l2.9-4.4a1 1 0 0 1 1.7.2l.5 1.4a2 2 0 0 1-.1 1.6l-.9 1.5h2.6a1.6 1.6 0 0 1 1.6 1.9l-.7 3.6a1.6 1.6 0 0 1-1.6 1.3H5.2Zm0 0H3.1a.6.6 0 0 1-.6-.6V7.5a.6.6 0 0 1 .6-.6h2.1"
    stroke="currentColor"
  />
));

/** 踩 */
export const IconThumbDown = createIcon('IconThumbDown', 16, () => (
  <path
    d="M10.8 2.5v6.6l-2.9 4.4a1 1 0 0 1-1.7-.2l-.5-1.4a2 2 0 0 1 .1-1.6l.9-1.5H4.1a1.6 1.6 0 0 1-1.6-1.9l.7-3.6A1.6 1.6 0 0 1 4.8 2h6Zm0 0h2.1a.6.6 0 0 1 .6.6v5.4a.6.6 0 0 1-.6.6h-2.1"
    stroke="currentColor"
  />
));

/** 分叉：从消息生出新分支 */
export const IconFork = createIcon('IconFork', 16, () => (
  <>
    <circle cx="4" cy="3.6" r="1.5" stroke="currentColor" />
    <circle cx="4" cy="12.4" r="1.5" stroke="currentColor" />
    <circle cx="12" cy="6.4" r="1.5" stroke="currentColor" />
    <path d="M4 5.1v5.8M5.5 8.4h3.2a1.8 1.8 0 0 0 1.8-1.8V7.9" stroke="currentColor" />
  </>
));

/** 重新生成 */
export const IconRefresh = createIcon('IconRefresh', 16, () => (
  <>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" stroke="currentColor" />
    <path d="M13.4 2.4v3h-3" stroke="currentColor" />
  </>
));

/** 置顶：图钉 */
export const IconPin = createIcon('IconPin', 16, () => (
  <>
    <path d="M6.4 3.1h3.2v4.3H6.4z" stroke="currentColor" />
    <path d="M4.9 7.4h6.2" stroke="currentColor" />
    <path d="M8 7.9v5.2" stroke="currentColor" />
  </>
));
