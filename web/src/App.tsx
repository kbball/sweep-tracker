import { Link, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { MapPage } from './pages/MapPage'
import { AdminPage } from './pages/AdminPage'
import { Tour } from './Tour'

export function App() {
  return (
    <>
      <Tour />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/e/:id" element={<MapPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<p className="page">Not found. <Link to="/">Home</Link></p>} />
      </Routes>
    </>
  )
}
