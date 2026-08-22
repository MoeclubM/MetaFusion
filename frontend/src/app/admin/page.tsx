"use client";

import React, { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import { useAdminDashboard } from "./hooks/useAdminDashboard";
import { AdminHeader } from "./components/AdminHeader";
import { AdminSidebar } from "./components/AdminSidebar";
import { OverviewTab } from "./components/tabs/OverviewTab";
import { ReviewsTab } from "./components/tabs/ReviewsTab";
import { WorksTab } from "./components/tabs/WorksTab";
import { ExpressionsTab } from "./components/tabs/ExpressionsTab";
import { ReleasesTab } from "./components/tabs/ReleasesTab";
import { AssetsTab } from "./components/tabs/AssetsTab";
import { AgentsTab } from "./components/tabs/AgentsTab";
import { UsersTab } from "./components/tabs/UsersTab";
import { TopicsTab } from "./components/tabs/TopicsTab";
import { BoardsTab } from "./components/tabs/BoardsTab";
import { AuditTab } from "./components/tabs/AuditTab";
import { HealthTab } from "./components/tabs/HealthTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { ShelvesTab } from "./components/tabs/ShelvesTab";
import { CategoriesTab } from "./components/tabs/CategoriesTab";
import { EntityTypesTab } from "./components/tabs/EntityTypesTab";
import { ArtistModal } from "./components/modals/ArtistModal";
import { ShelfModal } from "./components/modals/ShelfModal";

function AdminContent() {
  const d = useAdminDashboard();
  if (d.authLoading || (!d.user && d.loading)) {
    return (
      <div className="dark min-h-screen bg-[#0a0a0c] flex items-center justify-center text-gray-400 font-mono text-xs">
        <RefreshCw className="w-4 h-4 animate-spin mr-2 text-amber-400" />
        {d.t("admin.loading")}
      </div>
    );
  }
  return (
    <div className="dark min-h-screen bg-[#0a0a0c] text-gray-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      <AdminHeader activeTab={d.activeTab} searchQuery={d.searchQuery} setSearchQuery={d.setSearchQuery} loading={d.loading} loadData={d.loadData} user={d.user} logout={d.logout} />
      <div className="flex-1 flex overflow-hidden">
        <AdminSidebar activeTab={d.activeTab} setActiveTab={d.setActiveTab} setSearchQuery={d.setSearchQuery} pendingReviewsCount={d.pendingReviewsCount} />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {d.activeTab === "overview" && <OverviewTab stats={d.stats} worksList={d.worksList} expressionsList={d.expressionsList} releasesList={d.releasesList} assetsList={d.assetsList} artistsList={d.artistsList} usersList={d.usersList} topicsList={d.topicsList} auditLogs={d.auditLogs} setActiveTab={d.setActiveTab} />}
          {d.activeTab === "reviews" && <ReviewsTab loading={d.loading} filteredReviewWorks={d.filteredReviewWorks} pendingReviewsCount={d.pendingReviewsCount} reviewFilter={d.reviewFilter} setReviewFilter={d.setReviewFilter} reviewingId={d.reviewingId} handleApproveWork={d.handleApproveWork} handleRejectWork={d.handleRejectWork} />}
          {d.activeTab === "works" && <WorksTab loading={d.loading} filteredWorks={d.filteredWorks} />}
          {d.activeTab === "expressions" && <ExpressionsTab loading={d.loading} filteredExpressions={d.filteredExpressions} worksList={d.worksList} handleDeleteExpression={d.handleDeleteExpression} />}
          {d.activeTab === "releases" && <ReleasesTab loading={d.loading} filteredReleases={d.filteredReleases} expandedReleaseId={d.expandedReleaseId} setExpandedReleaseId={d.setExpandedReleaseId} verifyingReleaseId={d.verifyingReleaseId} handleToggleVerification={d.handleToggleVerification} />}
          {d.activeTab === "assets" && <AssetsTab loading={d.loading} filteredAssets={d.filteredAssets} handleRetryAsset={d.handleRetryAsset} />}
          {d.activeTab === "artists" && <AgentsTab loading={d.loading} filteredArtists={d.filteredArtists} artistsList={d.artistsList} selectedEntityType={d.selectedEntityType} setSelectedEntityType={d.setSelectedEntityType} handleOpenCreateArtist={d.handleOpenCreateArtist} handleOpenEditArtist={d.handleOpenEditArtist} handleDeleteArtist={d.handleDeleteArtist} />}
          {d.activeTab === "entity_types" && <EntityTypesTab />}
          {d.activeTab === "users" && <UsersTab loading={d.loading} filteredUsers={d.filteredUsers} roleUpdatingId={d.roleUpdatingId} user={d.user} handleUpdateRole={d.handleUpdateRole} handleUpdateUser={d.handleUpdateUser} />}
          {d.activeTab === "topics" && <TopicsTab loading={d.loading} topicsList={d.topicsList} handleDeleteTopic={d.handleDeleteTopic} />}
          {d.activeTab === "boards" && <BoardsTab />}
          {d.activeTab === "audit" && <AuditTab auditLogs={d.auditLogs} />}
          {d.activeTab === "health" && <HealthTab />}
          {d.activeTab === "settings" && <SettingsTab />}
          {d.activeTab === "shelves" && <ShelvesTab loading={d.loading} filteredShelves={d.filteredShelves} handleOpenCreateShelf={d.handleOpenCreateShelf} handleOpenEditShelf={d.handleOpenEditShelf} handleDeleteShelf={d.handleDeleteShelf} />}
          {d.activeTab === "relationships" && <CategoriesTab />}
        </main>
      </div>
      <ArtistModal open={d.isArtistModalOpen} onClose={() => d.setIsArtistModalOpen(false)} editingArtist={d.editingArtist} artistForm={d.artistForm} setArtistForm={d.setArtistForm} artistSubmitting={d.artistSubmitting} handleSaveArtist={d.handleSaveArtist} />
      <ShelfModal open={d.isShelfModalOpen} onClose={() => d.setIsShelfModalOpen(false)} shelfForm={d.shelfForm} setShelfForm={d.setShelfForm} shelfTagInput={d.shelfTagInput} setShelfTagInput={d.setShelfTagInput} handleSaveShelf={d.handleSaveShelf} />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-[#0a0a0c] flex items-center justify-center text-gray-400 font-mono text-xs">Loading MetaFusion Admin...</div>}>
      <AdminContent />
    </Suspense>
  );
}
