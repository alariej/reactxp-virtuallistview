/**
 * VirtualListCell.tsx
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT license.
 *
 * This helper class is used in conjunction with VirtualListView. It represents the
 * container for a single list item.
 */
/// <reference types="react" />
import * as RX from 'reactxp';
export interface VirtualListCellInfo {
    key: string;
    disableTouchOpacityAnimation?: boolean;
}
export interface VirtualListCellRenderDetails<T extends VirtualListCellInfo> {
    item: T;
    selected: boolean;
    focused: boolean;
}
export interface VirtualListCellProps<ItemInfo extends VirtualListCellInfo> extends RX.CommonProps {
    onLayout?: (itemKey: string, height: number) => void;
    onAnimateStartStop?: (itemKey: string, start: boolean) => void;
    onItemFocused?: (item: ItemInfo | undefined) => void;
    onItemSelected?: (item: ItemInfo) => void;
    renderItem: (details: VirtualListCellRenderDetails<ItemInfo>) => JSX.Element | JSX.Element[];
    onKeyPress: (ev: RX.Types.KeyboardEvent) => void;
    itemKey: string | undefined;
    left: number;
    top: number;
    width: number;
    isVisible: boolean;
    useNativeDriver?: boolean;
    showOverflow?: boolean;
    isScreenReaderModeEnabled?: boolean;
    isActive: boolean;
    isFocused: boolean;
    isSelected: boolean;
    tabIndex?: number;
    shouldUpdate: boolean;
    item: ItemInfo | undefined;
}
export declare class VirtualListCell<ItemInfo extends VirtualListCellInfo> extends RX.Component<VirtualListCellProps<ItemInfo>, RX.Stateless> {
    private static StaticRenderer;
    private static _hiddenTopValue;
    private _isVisible;
    private _top;
    private _calculatedHeight;
    private _topValue;
    private _ref;
    private _animatedStylePosition;
    private _staticStylePosition;
    private _topAnimation;
    private _itemKey;
    constructor(props: VirtualListCellProps<ItemInfo>);
    UNSAFE_componentWillReceiveProps(nextProps: VirtualListCellProps<ItemInfo>): void;
    shouldComponentUpdate(nextProps: VirtualListCellProps<ItemInfo>): boolean;
    componentDidUpdate(prevProps: VirtualListCellProps<ItemInfo>): void;
    componentWillUnmount(): void;
    setVisibility(isVisible: boolean): void;
    isVisible(): boolean;
    setTop(top: number, animate?: boolean, animationDelay?: number, animationOvershoot?: number): void;
    cancelPendingAnimation(): void;
    setItemKey(key: string | undefined): void;
    getTop(): number;
    focus(): void;
    render(): JSX.Element;
    private _onKeyPress;
    private _onFocus;
    private _onPress;
    private _onBlur;
    private _onLayout;
}
