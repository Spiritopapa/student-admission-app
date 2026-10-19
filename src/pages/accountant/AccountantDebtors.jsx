import { AlertTriangle, Building2 } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { PageHeader, EmptyState } from '../../components/ui';
import DebtorsTab from '../../components/DebtorsTab';

export default function AccountantDebtors() {
  const schoolId = useSchoolId();

  if (!schoolId) {
    return (
      <EmptyState
        icon={Building2}
        title="No school linked"
        message="This accountant account is not linked to a school yet. Ask the school administrator to link your account, then sign out and back in."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Debtors"
        subtitle="Students with outstanding fee balances — search, print, export or send reminder SMS to parents."
        icon={AlertTriangle}
      />
      <DebtorsTab />
    </div>
  );
}
