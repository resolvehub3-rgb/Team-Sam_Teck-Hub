import React, { useState, useEffect } from 'react';
import {
  Briefcase,
  Plus,
  DollarSign,
  TrendingUp,
  FileCheck,
  Calendar,
  AlertCircle,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { BusinessProposal, ExpenseRecord, Project } from '../types/database';
import { calculateProjectBudgetStats } from '../utils/rules';

export const BusinessView: React.FC = () => {
  const { user, organization, role } = useAuth();
  const [proposals, setProposals] = useState<BusinessProposal[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // New Proposal Modal
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [propTitle, setPropTitle] = useState('');
  const [propClient, setPropClient] = useState('');
  const [propScope, setPropScope] = useState('');
  const [propBudget, setPropBudget] = useState('0');
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);

  // New Expense Modal
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('0');
  const [expCategory, setExpCategory] = useState('Software');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expProjectId, setExpProjectId] = useState('');
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  const canAccessFinance = role === 'super_admin' || role === 'team_leader';

  const fetchBusinessData = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Proposals
      let propQuery = supabase.from('business_proposals').select('*').order('created_at', { ascending: false });
      if (organization?.id) propQuery = propQuery.eq('organization_id', organization.id);
      const { data: propData } = await propQuery;
      setProposals((propData as BusinessProposal[]) || []);

      // 2. Expenses
      let expQuery = supabase.from('expense_records').select('*').order('expense_date', { ascending: false });
      if (organization?.id) expQuery = expQuery.eq('organization_id', organization.id);
      const { data: expData } = await expQuery;
      setExpenses((expData as ExpenseRecord[]) || []);

      // 3. Projects
      let projQuery = supabase.from('projects').select('*');
      if (organization?.id) projQuery = projQuery.eq('organization_id', organization.id);
      const { data: projData } = await projQuery;
      setProjects((projData as Project[]) || []);
    } catch (err) {
      console.error('Error querying business data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinessData();
  }, [organization?.id]);

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propTitle.trim() || !user) return;
    setIsSubmittingProposal(true);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase
        .from('business_proposals')
        .insert({
          organization_id: orgId,
          title: propTitle.trim(),
          client_partner_name: propClient.trim() || null,
          scope_description: propScope.trim(),
          proposed_budget: parseFloat(propBudget) || 0,
          status: 'draft',
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      setShowProposalModal(false);
      setPropTitle('');
      setPropClient('');
      setPropScope('');
      fetchBusinessData();
    } catch (err) {
      alert('Failed to save proposal: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingProposal(false);
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() || !user) return;
    setIsSubmittingExpense(true);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase
        .from('expense_records')
        .insert({
          organization_id: orgId,
          project_id: expProjectId || null,
          title: expTitle.trim(),
          amount: parseFloat(expAmount) || 0,
          category: expCategory,
          expense_date: expDate,
          recorded_by: user.id,
          is_approved: true, // auto approved for super_admin / team_leader
        })
        .select()
        .single();

      if (error) throw error;
      setShowExpenseModal(false);
      setExpTitle('');
      setExpAmount('0');
      fetchBusinessData();
    } catch (err) {
      alert('Failed to record expense: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  // Real calculations
  const totalAllocatedBudget = projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
  const totalApprovedExpenses = expenses
    .filter((e) => e.is_approved)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const remainingBudget = totalAllocatedBudget - totalApprovedExpenses;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-[#123B73]" />
            Business & Resource Operations
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Client proposals, partner engagements, and authorized project expenditure records.
          </p>
        </div>

        {canAccessFinance && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowExpenseModal(true)}
              className="px-3 py-2 bg-[#2457A7] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Record Expense
            </button>
            <button
              onClick={() => setShowProposalModal(true)}
              className="px-3 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              New Proposal
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards: STRICT REAL NUMBERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Total Allocated Budget</span>
          <div className="text-2xl font-extrabold text-[#172B4D] mt-1">
            {totalAllocatedBudget.toLocaleString()}
          </div>
          <span className="text-[11px] text-[#65758B]">Sum of active project budgets</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Approved Expenditures</span>
          <div className="text-2xl font-extrabold text-[#172B4D] mt-1">
            {totalApprovedExpenses.toLocaleString()}
          </div>
          <span className="text-[11px] text-[#65758B]">{expenses.length} total logged expenses</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#DCE5F0] shadow-xs">
          <span className="text-xs font-semibold text-[#65758B]">Remaining Capital</span>
          <div className="text-2xl font-extrabold text-[#123B73] mt-1">
            {remainingBudget.toLocaleString()}
          </div>
          <span className="text-[11px] text-[#65758B]">Available organization balance</span>
        </div>
      </div>

      {/* Grid: Proposals + Expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Proposals */}
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#DCE5F0]">
            <h2 className="text-sm font-bold text-[#172B4D]">Client & Partner Proposals</h2>
            <span className="text-xs text-[#65758B]">{proposals.length} total</span>
          </div>

          {proposals.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#65758B] border border-dashed border-[#DCE5F0] rounded-lg p-6">
              <Briefcase className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
              <p className="font-semibold text-[#172B4D]">No business proposals recorded</p>
              <p className="text-[11px] text-[#65758B] mt-1">
                Draft client service proposals and partnerships.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((p) => (
                <div key={p.id} className="p-3.5 rounded-lg border border-[#DCE5F0] bg-[#F5F8FC]/50 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#172B4D]">{p.title}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-blue-50 text-[#123B73] border border-[#DCE5F0]">
                      {p.status}
                    </span>
                  </div>
                  {p.client_partner_name && (
                    <div className="text-[11px] text-[#65758B]">Partner: {p.client_partner_name}</div>
                  )}
                  <div className="text-[11px] font-semibold text-[#123B73]">
                    Budget: {p.proposed_budget.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#DCE5F0]">
            <h2 className="text-sm font-bold text-[#172B4D]">Expense Ledger</h2>
            <span className="text-xs text-[#65758B]">{expenses.length} records</span>
          </div>

          {expenses.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#65758B] border border-dashed border-[#DCE5F0] rounded-lg p-6">
              <DollarSign className="w-8 h-8 text-[#65758B]/40 mx-auto mb-2" />
              <p className="font-semibold text-[#172B4D]">No financial records yet</p>
              <p className="text-[11px] text-[#65758B] mt-1">
                Log authorized equipment, software, and operational expenses.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map((exp) => (
                <div key={exp.id} className="p-3 rounded-lg border border-[#DCE5F0] flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-[#172B4D]">{exp.title}</div>
                    <div className="text-[10px] text-[#65758B]">
                      {exp.category} • {exp.expense_date}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-extrabold text-[#123B73]">{exp.amount.toLocaleString()}</div>
                    <span className="text-[10px] text-emerald-600 font-semibold">Approved</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* NEW PROPOSAL MODAL */}
      {showProposalModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">New Business Proposal</h2>
              <button onClick={() => setShowProposalModal(false)} className="text-[#65758B] hover:text-[#172B4D]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProposal} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Proposal Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Enterprise Cloud Migration"
                  value={propTitle}
                  onChange={(e) => setPropTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Client / Partner Name</label>
                <input
                  type="text"
                  placeholder="e.g. Acme Tech Solutions"
                  value={propClient}
                  onChange={(e) => setPropClient(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Scope & Deliverables *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe scope, key milestones, and deliverables..."
                  value={propScope}
                  onChange={(e) => setPropScope(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Proposed Budget</label>
                <input
                  type="number"
                  value={propBudget}
                  onChange={(e) => setPropBudget(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowProposalModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingProposal}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmittingProposal ? 'Saving...' : 'Save Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD EXPENSE MODAL */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Record Approved Expense</h2>
              <button onClick={() => setShowExpenseModal(false)} className="text-[#65758B] hover:text-[#172B4D]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">Expense Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cloud Infrastructure / Server hosting"
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Amount *</label>
                  <input
                    type="number"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Category</label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="Software">Software</option>
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Hardware">Hardware</option>
                    <option value="Operations">Operations</option>
                    <option value="Travel">Travel</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Linked Project</label>
                  <select
                    value={expProjectId}
                    onChange={(e) => setExpProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                  >
                    <option value="">General Org Expense</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExpense}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmittingExpense ? 'Recording...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
