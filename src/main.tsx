import { createRoot } from 'react-dom/client';

import { App } from './app/app.tsx';
import './styles.css';

const root = document.querySelector('#root');

if (root === null) throw new Error('Application root was not found');

createRoot(root).render(<App />);
