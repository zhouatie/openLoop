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

/* 引用字形取自 DSH ReferenceIcon：文件是带两行正文的圆角框 */
export const IconReferenceFile = createIcon('IconReferenceFile', 16, () => (
  <>
    <path d="M4.9375 5.90295H11.0625" stroke="currentColor" />
    <path d="M4.9375 9.02991H8.27841" stroke="currentColor" />
    <path
      d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z"
      fill="currentColor"
    />
  </>
));

/* 会话引用：DSH ReferenceIcon 的对话气泡加两行文字 */
export const IconChatLines = createIcon('IconChatLines', 16, () => (
  <>
    <path d="M5 6.75H11" stroke="currentColor" />
    <path d="M5 9H8" stroke="currentColor" />
    <path
      d="M2.37067 11.2497C1.5872 9.89252 1.32042 8.29798 1.61945 6.7597C1.91847 5.22141 2.76317 3.84293 3.99801 2.87809C5.23285 1.91325 6.7747 1.427 8.33964 1.50888C9.90458 1.59076 11.3873 2.23526 12.5147 3.32369C13.6422 4.41232 14.3384 5.8717 14.4751 7.43304C14.6118 8.99438 14.1797 10.5525 13.2585 11.8205C12.3372 13.0885 10.9889 13.9809 9.4617 14.3334C8.18666 14.6277 6.8587 14.529 5.64964 14.0601C5.17095 13.8745 4.76937 13.4929 4.26509 13.3963C3.67389 13.2832 2.95232 13.5595 2.0377 14.3334"
      stroke="currentColor"
    />
  </>
));

/* 右箭头：DSH ChevronRightOutline，行尾下钻提示用 */
export const IconChevronRight = createIcon('IconChevronRight', 12, () => (
  <path
    d="M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const IconMinimize = createIcon('IconMinimize', 16, () => (
  <path d="M3.5 8h9" stroke="currentColor" />
));

/** 权限：DSH PermissionIcon 的盾形轮廓 */
export const IconShield = createIcon('IconShield', 16, () => (
  <>
    <path
      d="M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z"
      stroke="currentColor"
      strokeLinejoin="round"
    />
    <path d="M8 4.39209V9.89209" stroke="currentColor" />
    <path d="M8 10.8081V11.8081" stroke="currentColor" />
  </>
));

/** 模型：芯片轮廓 */
export const IconChip = createIcon('IconChip', 16, () => (
  <>
    <rect x="3.9" y="3.9" width="8.2" height="8.2" rx="2.2" stroke="currentColor" />
    <rect x="6.6" y="6.6" width="2.8" height="2.8" rx="1" stroke="currentColor" />
    <path
      d="M6.4 3.9V2M9.6 3.9V2M6.4 14V12.1M9.6 14V12.1M3.9 6.4H2M3.9 9.6H2M14 6.4H12.1M14 9.6H12.1"
      stroke="currentColor"
    />
  </>
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

/** 展开侧边栏（DSH panel-left-outline） */
export const IconPanelLeft = createIcon('IconPanelLeft', 16, () => (
  <>
    <rect x="1.5" y="1.5" width="13" height="13" rx="1" stroke="currentColor" />
    <path d="M5.5 1.5V14.5" stroke="currentColor" />
  </>
));

/** DSH artwork: check-outline */
export const IconCheck = createIcon('IconCheck', 14, () => (
  <path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor" />
));

/** DSH artwork: database-outline */
export const IconDatabase = createIcon('IconDatabase', 15, () => (
  <>
    <path d="M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z" stroke="currentColor" />
    <path d="M2 3.80371V11.7848" stroke="currentColor" />
    <path d="M14 3.80371V11.7848" stroke="currentColor" />
    <path d="M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396" stroke="currentColor" />
    <path d="M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847" stroke="currentColor" />
  </>
));

/** DSH artwork: wrap-fill */
export const IconWrap = createIcon('IconWrap', 14, () => (
  <>
    <path
      d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M2 15H1V1H2V15Z" fill="currentColor" stroke="none" />
    <path d="M15 15H14V1H15V15Z" fill="currentColor" stroke="none" />
  </>
));

/** DSH artwork: nowrap-fill */
export const IconNoWrap = createIcon('IconNoWrap', 14, () => (
  <>
    <path d="M2 15H1V1H2V15Z" fill="currentColor" stroke="none" />
    <path
      d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M15 15H14V1H15V15Z" fill="currentColor" stroke="none" />
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

/** 思考：DSH think-outline */
export const IconThink = createIcon('IconThink', 16, () => (
  <>
    <path
      d="M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z"
      stroke="currentColor"
    />
    <path
      d="M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z"
      stroke="currentColor"
    />
    <path
      d="M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z"
      fill="currentColor"
    />
  </>
));

/** 上折角：DSH chevrons-up-outline */
export const IconChevronUp = createIcon('IconChevronUp', 12, () => (
  <path d="M3.5 9.5L8 5L12.5 9.5" stroke="currentColor" strokeLinecap="round" />
));

/** 命令：DSH api-outline */
export const IconCommand = createIcon('IconCommand', 14, () => (
  <>
    <path d="M3 4L7 8L3 12" stroke="currentColor" />
    <path d="M9 12H13" stroke="currentColor" />
  </>
));

/** 网络：DSH globe-outline */
export const IconGlobe = createIcon('IconGlobe', 14, () => (
  <>
    <path
      d="M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z"
      stroke="currentColor"
    />
    <path d="M2.34619 8H13.6538" stroke="currentColor" />
    <path
      d="M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138"
      stroke="currentColor"
    />
    <path
      d="M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138"
      stroke="currentColor"
    />
  </>
));

/** 代码：DSH code-outline */
export const IconCode = createIcon('IconCode', 14, () => (
  <>
    <path d="M6.27612 1.5L4.52612 14.5" stroke="currentColor" />
    <path d="M11.4739 1.5L9.72388 14.5" stroke="currentColor" />
    <path d="M2.39868 5.5H14.0681" stroke="currentColor" />
    <path d="M1.93188 10.5H13.6013" stroke="currentColor" />
  </>
));

/** 视图选项（DSH sliders-two-outline） */
export const IconSliders = createIcon('IconSliders', 16, () => (
  <>
    <path d="M2.3 5h5.85M12.05 5h1.65" stroke="currentColor" />
    <circle cx="9.95" cy="5" r="1.45" stroke="currentColor" />
    <path d="M2.3 11h1.65M7.85 11h5.85" stroke="currentColor" />
    <circle cx="5.75" cy="11" r="1.45" stroke="currentColor" />
  </>
));

/* DSH FileTypeIcon 的 code 字形（28 栅格填充文件，MIT） */
const FILE_CODE_BODY =
  'M8.48924 28H19.5108C21.6479 28 22.7165 28 23.5594 27.6509C24.6833 27.1853 25.5762 26.2924 26.0417 25.1685C26.3909 24.3256 26.3909 23.257 26.3909 21.1199V8.79443C26.3909 8.32877 26.3909 8.09593 26.3471 7.87507C26.2887 7.58058 26.173 7.30042 26.0067 7.05048C25.882 6.86303 25.7177 6.69799 25.3893 6.36792L20.0611 1.01354C19.7304 0.681235 19.5651 0.515081 19.3769 0.38885C19.126 0.220541 18.8443 0.103463 18.5481 0.0443412C18.3259 0 18.0915 0 17.6226 0H8.48924C6.35209 0 5.28351 0 4.4406 0.349145C3.31672 0.814671 2.4238 1.70759 1.95828 2.83147C1.60913 3.67438 1.60913 4.74296 1.60913 6.88011V21.1199C1.60913 23.257 1.60913 24.3256 1.95828 25.1685C2.4238 26.2924 3.31672 27.1853 4.4406 27.6509C5.28351 28 6.35209 28 8.48924 28Z';
const FILE_CODE_FOLD =
  'M26.3909 7.37445L19.0525 0V3.77445C19.0525 4.89271 19.0525 5.45184 19.2352 5.89289C19.4788 6.48096 19.946 6.94818 20.5341 7.19176C20.9751 7.37445 21.5342 7.37445 22.6525 7.37445H26.3909Z';

/** 代码文件：DSH FileTypeIcon kind="code"，颜色随 currentColor */
export const IconFileCode = React.memo(function IconFileCode({ size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={FILE_CODE_BODY} fill="currentColor" />
      <path d={FILE_CODE_FOLD} fill="var(--dsw-static-neutral-00)" fillOpacity="0.7" />
      <g color="var(--dsw-static-neutral-00)">
        <path
          d="M10.0053 13.126L7.0236 16.3788C6.96052 16.4476 6.96052 16.5532 7.0236 16.622L10.0053 19.8748"
          stroke="currentColor"
          strokeWidth="1.35"
        />
        <path
          d="M17.9941 13.126L20.9759 16.3788C21.039 16.4476 21.039 16.5532 20.9759 16.622L17.9941 19.8748"
          stroke="currentColor"
          strokeWidth="1.35"
        />
        <path d="M15.2652 12.957L12.7344 20.0433" stroke="currentColor" strokeWidth="1.35" />
      </g>
    </svg>
  );
});

/** 分栏对比（DSH compare-split-outline） */
export const IconCompareSplit = createIcon('IconCompareSplit', 14, () => (
  <>
    <rect x="1.9" y="2.3" width="12.2" height="11.4" rx="1.8" stroke="currentColor" />
    <path d="M8 2.3v11.4" stroke="currentColor" />
  </>
));

/** 单列表分组（DSH flat-list-outline） */export const IconFlatList = createIcon('IconFlatList', 16, () => (
  <>
    <path d="M6 3.5h7.5M6 8h7.5M6 12.5h7.5" stroke="currentColor" />
    <path d="M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01" stroke="currentColor" />
  </>
));

/** 归档检查（DSH archive-check-outline） */
export const IconArchiveCheck = createIcon('IconArchiveCheck', 16, () => (
  <>
    <rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1" stroke="currentColor" />
    <path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7" stroke="currentColor" />
    <path d="m6 9.35 1.4 1.4 2.6-2.6" stroke="currentColor" />
  </>
));

/** 空归档（DSH archive-off-outline 的无遮罩简化版，避免重复 mask id） */
export const IconArchiveOff = createIcon('IconArchiveOff', 16, () => (
  <>
    <rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1" stroke="currentColor" />
    <path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7" stroke="currentColor" />
    <path d="m2.6 1.7 10.8 11.9" stroke="currentColor" />
  </>
));

/** 全部对话（DSH queue-outline） */
export const IconQueue = createIcon('IconQueue', 16, () => (
  <>
    <path d="M5 6.75H11" stroke="currentColor" />
    <path d="M5 9H8" stroke="currentColor" />
    <path d="M2.37 11.25a6.6 6.6 0 1 1 12.11-1.41 6.6 6.6 0 0 1-8.83 4.22c-.48-.19-.88-.57-1.38-.66-.6-.12-1.32.16-2.23.93" stroke="currentColor" />
  </>
));

/** 编辑（DSH edit-outline）：排队中的输入回填到输入框 */
export const IconEdit = createIcon('IconEdit', 16, () => (
  <>
    <path
      d="M8.86 2.7H4.2C3.37 2.7 2.7 3.37 2.7 4.2v7.6c0 .83.67 1.5 1.5 1.5h7.6c.83 0 1.5-.67 1.5-1.5V7.9h1v3.9c0 1.38-1.12 2.5-2.5 2.5H4.2c-1.38 0-2.5-1.12-2.5-2.5V4.2c0-1.38 1.12-2.5 2.5-2.5h4.66v1Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M7.78 8.24 13.89 2.14" stroke="currentColor" />
  </>
));

/** 删除（DSH trash-outline）：撤回排队中的输入 */
export const IconTrash = createIcon('IconTrash', 16, () => (
  <>
    <path d="M1.28 3.89h13.44" stroke="currentColor" />
    <path d="M5.42 3.89V2.48c0-.19.1-.37.3-.5.19-.13.46-.2.73-.2h3.1c.27 0 .54.07.73.2.19.13.3.31.3.5v1.41" stroke="currentColor" />
    <path
      d="M2.57 3.89l.62 9.4c.03.26.15.5.34.67.19.17.44.27.7.27h7.54c.26 0 .51-.1.7-.27.19-.17.31-.41.34-.67l.62-9.4"
      stroke="currentColor"
    />
    <path d="M6.45 6.99v4.13M9.55 6.99v4.13" stroke="currentColor" />
  </>
));

/** 最近更新（DSH clock-outline） */
export const IconClock = createIcon('IconClock', 16, () => (
  <>
    <path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor" />
    <path d="M8 4.31V8.46L11 10.08" stroke="currentColor" />
  </>
));

/** 任务：勾选清单，➕ 面板的任务入口 */
export const IconTask = createIcon('IconTask', 16, () => (
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" />
    <path d="M5.4 8.1 7.1 9.8 10.7 6.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </>
));

/** 任务组：层叠多边形，与任务组的多工序语义一致 */
export const IconGroup = createIcon('IconGroup', 16, () => (
  <>
    <path d="M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z" stroke="currentColor" strokeLinejoin="round" />
    <path d="M2.4 8 8 10.8 13.6 8" stroke="currentColor" strokeLinejoin="round" />
    <path d="M2.4 11 8 13.8 13.6 11" stroke="currentColor" strokeLinejoin="round" />
  </>
));

/** 执行：三角形播放键，流水线启动入口 */
export const IconRun = createIcon('IconRun', 16, () => (
  <path d="M5.6 3.4 12.4 8l-6.8 4.6V3.4Z" stroke="currentColor" strokeLinejoin="round" />
));
