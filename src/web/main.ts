import './styles/app.css';

// WebUI 本体は docs/design/d4d-studio-design.html の承認後に実装する。
// 現時点ではビルド経路の検証用プレースホルダのみ。
const app = document.querySelector<HTMLElement>('#app');
if (app) app.dataset.ready = 'placeholder';
