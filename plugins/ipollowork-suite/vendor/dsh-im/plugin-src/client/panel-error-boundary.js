import * as React from 'react';
import { h } from './i18n.js';

/** Keep a broken IM subtree local when a shell renders it outside a slot. */
export class IMPanelErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return h('section', { className: 'dim-page', role: 'alert' },
      h('p', null, 'IM 面板加载失败'),
      h('button', {
        type: 'button',
        onClick: () => this.setState({ failed: false }),
      }, '重试'));
  }
}
