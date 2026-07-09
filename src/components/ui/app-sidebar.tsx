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
import { useChat } from "@/hooks/use-chat";
import { usePathname, useRouter } from "expo-router";
import { EllipsisVertical, Pause, Settings2 } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const settingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const {
    conversations,
    currentConversation,
    runStatusByConversation,
    selectConversation,
    deleteConversation,
  } = useChat();

  return (
    <Sidebar showCloseButton>
      <SidebarHeader>
        <Text className="font-sans text-2xl font-semibold text-foreground dark:text-foreground-dark">
          Mobile Agent
        </Text>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarMenu>
            {conversations.map((conversation) => (
              <SidebarMenuItem key={conversation.id}>
                <SidebarClose asChild>
                  <SidebarMenuButton
                    isActive={conversation.id === currentConversation?.id}
                    onPress={() => {
                      selectConversation(conversation.id)
                        .then(() => {
                          router.push("/");
                        })
                        .catch(console.error);
                    }}
                  >
                    <View className="min-w-0 flex-1 flex flex-row justify-between">
                      <Text
                        className={cn(
                          "font-sans text-sm font-medium w-[90%]",
                          conversation.id === currentConversation?.id
                            ? "text-background dark:text-background-dark"
                            : "text-foreground dark:text-foreground-dark",
                        )}
                        numberOfLines={1}
                      >
                        {conversation.title}
                      </Text>
                      {runStatusByConversation[conversation.id] === "running" ||
                      runStatusByConversation[conversation.id] === "queued" ||
                      runStatusByConversation[conversation.id] ===
                        "resumable" ? (
                        <ActivityIndicator
                          color={
                            conversation.id === currentConversation?.id
                              ? theme.background
                              : theme.textSecondary
                          }
                          size="small"
                        />
                      ) : runStatusByConversation[conversation.id] ===
                        "waiting_for_approval" ? (
                        <Pause
                          color={
                            conversation.id === currentConversation?.id
                              ? theme.background
                              : theme.textSecondary
                          }
                          size={14}
                        />
                      ) : (
                        <ChatOptions
                          conversationId={conversation.id}
                          color={
                            conversation.id === currentConversation?.id
                              ? theme.background
                              : theme.textSecondary
                          }
                          size={14}
                        />
                      )}
                    </View>
                  </SidebarMenuButton>
                </SidebarClose>
              </SidebarMenuItem>
            ))}
            {conversations.length === 0 ? (
              <SidebarMenuItem>
                <Text className="px-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Your chats will show up here after hydration finishes.
                </Text>
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
  );
}

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function ChatOptions({
  color,
  size,
  conversationId,
}: {
  color: string;
  size: number;
  conversationId: string;
}) {
  const { deleteConversation } = useChat();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Pressable hitSlop={8}>
          <EllipsisVertical size={20} color={color} />
        </Pressable>
      </DropdownMenuTrigger>

      <DropdownMenuContent width={160}>
        <DropdownMenuItem onPress={() => deleteConversation(conversationId)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
