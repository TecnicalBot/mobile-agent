import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { usePathname, useRouter } from "expo-router";
import {
  EllipsisVertical,
  Library,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Settings2,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { Conversation } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";

export function AppSidebar() {
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const settingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const { hydrating } = useAppState();
  const {
    conversations,
    currentConversation,
    renameConversation,
    runStatusByConversation,
    selectConversation,
  } = useChat();
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const pinnedConversations = conversations.filter(
    (conversation) => conversation.pinnedAt,
  );
  const otherConversations = conversations.filter(
    (conversation) => !conversation.pinnedAt,
  );

  function renderConversation(conversation: (typeof conversations)[number]) {
    const active = conversation.id === currentConversation?.id;

    return (
      <SidebarMenuItem key={conversation.id}>
        <SidebarClose asChild>
          <SidebarMenuButton
            isActive={active}
            onPress={() => {
              selectConversation(conversation.id)
                .then(() => {
                  router.push("/");
                })
                .catch(console.error);
            }}
          >
            <View className="min-w-0 flex-1 flex-row items-center gap-sp-2">
              <Text
                className={cn(
                  "min-w-0 flex-1 font-sans text-sm font-medium",
                  active
                    ? "text-background dark:text-background-dark"
                    : "text-foreground dark:text-foreground-dark",
                )}
                numberOfLines={1}
              >
                {conversation.title}
              </Text>
              <View className="shrink-0 items-center justify-center">
                {runStatusByConversation[conversation.id] === "running" ||
                runStatusByConversation[conversation.id] === "queued" ||
                runStatusByConversation[conversation.id] === "resumable" ? (
                  <ActivityIndicator
                    color={active ? theme.background : theme.textSecondary}
                    size="small"
                  />
                ) : runStatusByConversation[conversation.id] ===
                  "waiting_for_approval" ? (
                  <Pause
                    color={active ? theme.background : theme.textSecondary}
                    size={14}
                  />
                ) : (
                  <ChatOptions
                    conversationId={conversation.id}
                    color={active ? theme.background : theme.textSecondary}
                    pinned={Boolean(conversation.pinnedAt)}
                    pinnedCount={pinnedConversations.length}
                    onRename={() => {
                      setRenameTarget(conversation);
                      setRenameTitle(conversation.title);
                      setRenameError(null);
                    }}
                  />
                )}
              </View>
            </View>
          </SidebarMenuButton>
        </SidebarClose>
      </SidebarMenuItem>
    );
  }

  const submitRename = () => {
    if (!renameTarget || !renameTitle.trim() || renaming) {
      return;
    }

    setRenaming(true);
    setRenameError(null);
    renameConversation(renameTarget.id, renameTitle)
      .then(() => {
        setRenameTarget(null);
      })
      .catch((renameFailure) => {
        setRenameError(
          renameFailure instanceof Error
            ? renameFailure.message
            : "Could not rename this chat.",
        );
      })
      .finally(() => {
        setRenaming(false);
      });
  };

  return (
    <>
      <Sidebar>
        <SidebarHeader className="min-h-8 justify-center">
          <Text className="font-sans text-2xl font-semibold text-foreground dark:text-foreground-dark">
            Mobile Agent
          </Text>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="pb-sp-2">
            <SidebarMenu className="gap-0">
              <SidebarMenuItem>
                <SidebarClose asChild>
                  <SidebarMenuButton
                    className="min-h-10 rounded-lg !px-0 !py-sp-1"
                    isActive={pathname === "/library"}
                    leftIcon={
                      <Library
                        color={
                          pathname === "/library"
                            ? theme.background
                            : theme.text
                        }
                        size={24}
                        strokeWidth={2.25}
                      />
                    }
                    onPress={() => {
                      router.push("/library");
                    }}
                  >
                    <Text
                      className={cn(
                        "font-sans text-lg font-semibold",
                        pathname === "/library"
                          ? "text-background dark:text-background-dark"
                          : "text-foreground dark:text-foreground-dark",
                      )}
                    >
                      Library
                    </Text>
                  </SidebarMenuButton>
                </SidebarClose>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {pinnedConversations.length > 0 ? (
            <SidebarGroup>
              <SidebarGroupLabel className="!px-0 text-sm font-semibold normal-case tracking-normal text-foreground dark:text-foreground-dark">
                Pinned
              </SidebarGroupLabel>
              <SidebarMenu>
                {pinnedConversations.map(renderConversation)}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
          <SidebarGroup>
            <SidebarGroupLabel className="!px-0 text-sm font-semibold normal-case tracking-normal text-foreground dark:text-foreground-dark">
              Chats
            </SidebarGroupLabel>
            <SidebarMenu>
              {otherConversations.map(renderConversation)}
              {conversations.length === 0 ? (
                <SidebarMenuItem>
                  {hydrating ? (
                    <View className="flex-row items-center gap-sp-2 px-sp-2 py-sp-2">
                      <ActivityIndicator
                        color={theme.textSecondary}
                        size="small"
                      />
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        Loading chats…
                      </Text>
                    </View>
                  ) : (
                    <Text className="px-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      No chats yet. Start a new conversation.
                    </Text>
                  )}
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <View className="border-t border-border pt-sp-3 dark:border-border-dark">
            <SidebarClose asChild>
              <SidebarMenuButton
                isActive={settingsActive}
                leftIcon={
                  <Settings2
                    color={settingsActive ? theme.background : theme.text}
                    size={16}
                  />
                }
                onPress={() => {
                  router.push("/settings");
                }}
              >
                Settings
              </SidebarMenuButton>
            </SidebarClose>
          </View>
        </SidebarFooter>
      </Sidebar>
      <Modal
        dismissible={!renaming}
        onOpenChange={(open) => {
          if (!open && !renaming) {
            setRenameTarget(null);
            setRenameError(null);
          }
        }}
        open={renameTarget !== null}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Rename chat</ModalTitle>
            <ModalDescription>
              Choose a title that makes this chat easy to find.
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Input
              accessibilityLabel="Chat title"
              autoFocus
              maxLength={80}
              onChangeText={setRenameTitle}
              onSubmitEditing={submitRename}
              returnKeyType="done"
              selectTextOnFocus
              value={renameTitle}
            />
            {renameError ? (
              <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                {renameError}
              </Text>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button
              disabled={renaming}
              onPress={() => {
                setRenameTarget(null);
                setRenameError(null);
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={!renameTitle.trim()}
              loading={renaming}
              onPress={submitRename}
              size="sm"
            >
              Rename
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

function ChatOptions({
  color,
  conversationId,
  onRename,
  pinned,
  pinnedCount,
}: {
  color: string;
  conversationId: string;
  onRename: () => void;
  pinned: boolean;
  pinnedCount: number;
}) {
  const { deleteConversation, setConversationPinned } = useChat();
  const theme = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Pressable hitSlop={8}>
          <EllipsisVertical size={20} color={color} />
        </Pressable>
      </DropdownMenuTrigger>

      <DropdownMenuContent width={190}>
        <DropdownMenuItem onPress={onRename}>
          <View className="flex-row items-center gap-sp-2">
            <Pencil color={theme.text} size={16} />
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Rename
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!pinned && pinnedCount >= 3}
          onPress={() => {
            setConversationPinned(conversationId, !pinned).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            {pinned ? (
              <PinOff color={theme.text} size={16} />
            ) : (
              <Pin color={theme.text} size={16} />
            )}
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {pinned
                ? "Unpin"
                : pinnedCount >= 3
                  ? "Pin limit reached"
                  : "Pin"}
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={() => {
            deleteConversation(conversationId).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            <Trash2 color={theme.destructive} size={16} />
            <Text className="font-sans text-base text-destructive dark:text-destructive-dark">
              Delete
            </Text>
          </View>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
