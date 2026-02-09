import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="card empty-state" style={{ marginTop: 60 }}>
      <AlertTriangle size={48} />
      <h3>Seite nicht gefunden</h3>
      <p>Die angeforderte Seite existiert nicht.</p>
      <button
        className="btn btn-primary"
        style={{ marginTop: 16 }}
        onClick={() => navigate('/')}
      >
        Zum Dashboard
      </button>
    </div>
  );
}

export default NotFound;
